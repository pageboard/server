const { createReadStream, createWriteStream } = require('node:fs');
const Path = require('node:path');
const { Deferred } = require.lazy('class-deferred');
const ndjson = require.lazy('ndjson');
const Upgrader = require.lazy('../upgrades');

module.exports = class ArchiveService {
	static name = 'archive';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(app, server) {
		server.get('/.api/archive',
			app.cache.disable(),
			app.auth.lock('webmaster'),
			req => req.run('archive.export', req.query)
		);
		// TODO process req.files with multer
		server.put('/.api/archive',
			app.auth.lock('webmaster'),
			req => req.run('archive.import', req.query)
		);
	}

	async export(req, { file, ids = [] }) {
		const { site, trx, res } = req;
		const { id } = site;
		const filepath = file ?? `${id}-${fileStamp()}.ndjson`;
		const counts = {
			users: 0,
			blocks: 0,
			hrefs: 0
		};

		let out;
		if (res.attachment) {
			counts.file = Path.basename(filepath);
			res.type('application/x-ndjson');
			res.attachment(counts.file);
			out = res;
		} else {
			counts.file = Path.resolve(this.app.cwd, filepath);
			out = createWriteStream(counts.file);
		}

		const finished = new Deferred();
		out.once('finish', finished.resolve);
		out.once('error', finished.reject);
		const jstream = ndjson.stringify();
		jstream.pipe(out);

		const nsite = site.toJSON();
		delete nsite.data.domains;
		jstream.write(nsite);

		const modifiers = {
			blocks(q) {
				q.where('standalone', false).select();
			},
			standalones(q) {
				q.where('standalone', true).select();
			},
			users(q) {
				q.where('type', 'user').select();
			}
		};

		const countParents = site.$modelClass.relatedQuery('parents', trx)
			.whereNot('parents.id', site.id)
			.whereNot('parents.type', 'user');

		const blocks = await site.$relatedQuery('children', trx)
			.modify(q => {
				if (ids.length > 0) q.whereIn('block.id', ids);
			})
			.where(q => {
				// workaround settings not being standalone on previous versions
				q.where('standalone', true).orWhere('type', 'settings');
			})
			.whereNotExists(countParents)
			.select()
			.withGraphFetched(`[
				parents(users),
				children(standalones) as standalones . children(blocks),
				children(blocks)
			]`)
			.modifiers(modifiers);
		const blocksId = new Set();
		counts.blocks += blocks.length;
		for (const block of blocks) {
			counts.users += writeBlocks(jstream, block, 'parents', blocksId);
			counts.blocks += writeBlocks(jstream, block, 'standalones', blocksId);
			if (block.children.length == 0) delete block.children;
			if (blocksId.has(block.id)) {
				console.error("Skip already inserted block", block.id, block.type);
			} else {
				jstream.write(block);
			}
		}

		const hrefs = await req.run('href.collect', {
			ids,
			content: true
		});
		counts.hrefs = hrefs.length;
		for (const href of hrefs) {
			jstream.write(href);
		}
		jstream.end();
		await finished;
		return counts;
	}
	static export = {
		title: 'Export site',
		$action: 'read',
		$lock: true,
		properties: {
			file: {
				title: 'File name',
				type: 'string',
				pattern: /^[\w-]+\.ndjson$/.source,
				nullable: true
			},
			ids: {
				title: 'List of id',
				type: 'array',
				items: {
					type: "string",
					format: 'id'
				}
			}
		}
	};

	async import(req, { file, empty, idMap, types = [] }) {
		const { site, trx } = req;
		const counts = {
			users: 0,
			blocks: 0,
			hrefs: 0
		};
		const fstream = createReadStream(Path.resolve(this.app.cwd, file))
			.pipe(ndjson.parse());

		let upgrader;
		const refs = new Map();
		const list = [];
		const beforeEachStandalone = obj => {
			if (obj.type == "site" || list.length == 0) {
				const toVersion = site.data.server;
				const fromVersion = obj.type == "site" && obj.data?.server || toVersion;

				upgrader = new Upgrader({
					site,
					idMap,
					from: fromVersion,
					to: toVersion
				});
			} else if (!obj.id) {
				if (obj.pathname) {
					obj.pathname = obj.pathname.replace(
						/\/uploads\/[^/]+\//,
						`/uploads/${site.id}/`
					);
				}
				return obj;
			}
			return upgrader.beforeEach(obj);
		};
		const afterEachStandalone = async obj => {
			if (types.includes(obj.type)) return;
			if (!obj.id) {
				counts.hrefs++;
				return site.$relatedQuery('hrefs', trx).insert(obj).onConflict(['_parent_id', 'url']).ignore();
			} else if (obj.type == "site") {
				if (empty) await req.run('site.empty', { id: req.site.id });
			} else if (obj.type == "user") {
				try {
					const user = await site.$modelClass.query(trx).where('type', 'user')
						.whereJsonText('data:email', obj.data.email).select('_id', 'id')
						.first().throwIfNotFound();
					refs.set(obj.id, user._id);
				} catch(err) {
					if (err.status != 404) throw err;
					const user = await site.$modelClass.query(trx)
						.insert(obj).returning('_id', 'id');
					refs.set(obj.id, user._id);
				}
				counts.users += 1;
			} else {
				if (obj.parents) {
					// e.g. settings < user
					obj.parents = obj.parents.map(id => {
						const kid = refs.get(id);
						if (!kid) {
							throw new HttpError.BadRequest(
								`Missing parent id: ${upgrader.reverseMap[id] ?? id}`
							);
						}
						return { "#dbRef": kid };
					});
				}
				if (obj.children) {
					// ensure non-standalone children are related to site
					for (const child of obj.children) {
						if (!child.parents) child.parents = [];
						child.parents.push({ "#dbRef": site._id });
					}
				}
				if (obj.standalones) {
					if (!obj.children) obj.children = [];
					for (const id of obj.standalones) {
						const kid = refs.get(id);
						if (!kid) {
							console.warn(
								`Missing child id: ${upgrader.reverseMap[id] ?? id}`
							);
						}
						obj.children.push({ "#dbRef": kid });
					}
					delete obj.standalones;
				}
				const row = await site.$relatedQuery('children', trx)
					.insertGraph(obj, {
						allowRefs: true
					}).returning('_id');
				counts.blocks += 1;
				refs.set(obj.id, row._id);
			}
		};

		fstream.on('data', obj => {
			list.push(beforeEachStandalone(obj));
		});


		await new Promise((resolve, reject) => {
			fstream.on('error', reject);
			fstream.on('finish', resolve);
		});

		for (let obj of list) {
			try {
				obj = await upgrader.process(obj);
				await afterEachStandalone(obj);
			} catch (err) {
				err.message = (err.message ?? "") +
					`\nwhile processing ${obj.type} ${obj.id}`;
				throw err;
			}
		}
		return counts;
	}

	static import = {
		title: 'Import site',
		$action: 'write',
		$lock: true,
		required: ['file'],
		properties: {
			file: {
				title: 'File path',
				type: 'string'
			},
			idMap: {
				title: 'Map ids',
				type: 'object',
				additionalProperties: { type: 'string' },
				default: {}
			},
			empty: {
				title: 'Empty before',
				type: 'boolean',
				default: false
			},
			excludes: {
				title: 'Excluded types',
				type: 'array',
				items: {
					type: "string",
					format: "name"
				}
			}
		}
	};
};

function fileStamp(d = new Date()) {
	const [str] = d.toISOString().split('.');
	return str
		.replace(/[-:]/g, '')
		.replace('T', '-')
		.slice(0, -2);
}

function writeBlocks(jstream, parent, key, ids) {
	const list = parent[key];
	const idList = new Array(list.length);
	let count = 0;
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		const { id } = item;
		if (!ids.has(id)) {
			ids.add(id);
			count += 1;
			jstream.write(item);
		}
		idList[i] = id;
	}
	if (idList.length > 0) {
		parent[key] = idList;
	} else {
		delete parent[key];
	}
	return count;
}
