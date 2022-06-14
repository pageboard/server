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
			app.cache.disable,
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

		const hrefs = await req.call('href.collect', {
			id: ids,
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

	async empty({ site, trx }) {
		await site.$relatedQuery('children', trx)
			.select(trx.raw('recursive_delete(block._id, TRUE)'));
		await site.$relatedQuery('hrefs', trx).delete();
	}
	static empty = {
		title: 'Empty site',
		$action: 'write'
	};

	async import(req, { file, idMap }) {
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
		const beforeEach = async obj => {
			if (!obj.id) {
				if (obj.pathname) {
					obj.pathname = obj.pathname.replace(
						/\/uploads\/[^/]+\//,
						`/uploads/${site.id}/`
					);
				}
				return obj;
			} else if (obj.type == "site") {
				if (!obj.data) obj.data = {};
				const toVersion = site.data.server;
				const fromVersion = obj.data.server ?? toVersion;
				// these imported values must not overwrite current ones
				delete obj.data.domains;
				if (site.data.module) delete obj.data.module;
				if (site.data.version) delete obj.data.version;

				upgrader = new Upgrader(site.$modelClass, {
					idMap,
					from: fromVersion,
					to: toVersion
				});
			}
			return upgrader.beforeEach(obj);
		};
		const afterEach = async obj => {
			if (!obj.id) {
				counts.hrefs++;
				return site.$relatedQuery('hrefs', trx).insert(obj);
			} else if (obj.type == "site") {
				await upgrader.afterEach(obj);
				await req.run('archive.empty');
				await site.$query(trx).patchObject({ data: obj.data });
			} else if (obj.type == "user") {
				await upgrader.afterEach(obj);
				try {
					const user = await site.$modelClass.query(trx).where('type', 'user')
						.whereJsonText('data:email', obj.data.email).select('_id', 'id')
						.first().throwIfNotFound();
					refs.set(obj.id, user._id);
				} catch(err) {
					if (err.status != 404) throw err;
					const user = site.$modelClass.query(trx).insert(obj).returning('_id', 'id');
					refs.set(obj.id, user._id);
				}
				counts.users += 1;
			} else {
				await upgrader.afterEach(obj);
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
							throw new HttpError.BadRequest(
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

		const list = [];
		fstream.on('data', async obj => {
			list.push(await beforeEach(obj));
		});


		await new Promise((resolve, reject) => {
			fstream.on('error', (err) => {
				reject(err);
			});
			fstream.on('finish', () => {
				resolve();
			});
		});

		for (let obj of list) {
			try {
				obj = await upgrader.process(obj);
				await afterEach(obj);
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
		required: ['file'],
		properties: {
			file: {
				title: 'File path',
				type: 'string'
			},
			idMap: {
				title: 'Map ids',
				type: 'object',
				default: {}
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
