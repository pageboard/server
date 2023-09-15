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
			app.cache.tag('data-:site'),
			app.auth.lock('webmaster'),
			req => req.run('archive.import', req.query)
		);
	}

	async export(req, { file, ids = [] }) {
		const { site, trx, res, ref, fun } = req;
		const { id } = site;
		const lang = site.data.languages?.length == 0 ? req.call('translate.lang') : null;
		const filepath = file ?? `${id}-${fileStamp()}.ndjson`;
		const { orphaned } = await site.$query(trx)
			.select(fun('block_delete_orphans', ref('block._id')).as('orphaned'));
		const counts = {
			users: 0,
			blocks: 0,
			hrefs: 0,
			orphaned
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

		const colOpts = { lang, content: Boolean(lang) };

		const modifiers = {
			blocks(q) {
				q.where('standalone', false)
					.whereNot('type', 'content')
					.columns(colOpts);
			},
			standalones(q) {
				q.where('standalone', true).columns(colOpts);
			},
			users(q) {
				q.where('type', 'user').columns(colOpts);
			}
		};

		const countParents = site.$modelClass.relatedQuery('parents', trx)
			.whereNot('parents.id', site.id)
			.whereNot('parents.type', 'user');

		const q = site.$relatedQuery('children', trx)
			.modify(q => {
				if (ids.length > 0) q.whereIn('block.id', ids);
			})
			.where(q => {
				// workaround settings not being standalone on previous versions
				q.where('standalone', true).orWhere('type', 'settings');
			})
			.whereNotExists(countParents)
			.columns(colOpts);

		const blocks = await q.withGraphFetched(`[
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

		if (!lang) {
			const contents = await site.$relatedQuery('children', trx)
				.with('parents', site.$relatedQuery('children', trx)
					.select('block._id')
					.joinRelated('parents')
					.whereNot('parents.type', 'site')
					.modify(q => {
						if (ids.length) q.whereIn('parents.id', ids);
					})
					.select(fun('array_agg', ref('parents.id')).as('parents'))
					.groupBy('block._id')
				)
				.join('parents', 'parents._id', 'block._id')
				.select('parents.parents')
				.where('block.type', 'content')
				.columns();
			counts.contents = contents.length;
			for (const content of contents) {
				jstream.write(content);
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

	async import(req, { file, empty, idMap, types = [], languages }) {
		const { site, trx, Block } = req;
		const counts = {
			users: 0,
			blocks: 0,
			hrefs: 0,
			langs: {
				in: new Set(),
				out: new Set()
			}
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
				if (languages && obj.data.languages) {
					site.data.languages = obj.data.languages;
					await req.run('site.update', site.data);
				}
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
				if (obj.type == "content") {
					if (site.data.languages?.includes(obj.data.lang)) {
						counts.langs.in.add(obj.data.lang);
					} else {
						counts.langs.out.add(obj.data.lang);
						return;
					}
				}
				const parents = [];
				if (obj.parents) {
					// e.g. settings < user
					for (const id of obj.parents) {
						const kid = refs.get(id);
						if (!kid) {
							throw new HttpError.BadRequest(
								`Missing parent id: ${upgrader.reverseMap[id] ?? id}`
							);
						}
						parents.push(kid);
					}
					delete obj.parents;
				}
				const children = [];
				if (obj.children) {
					// ensure non-standalone children are related to site
					for (const child of obj.children) {
						const rchild = await site.$relatedQuery('children', trx)
							.insert(child).returning('_id');
						children.push(rchild._id);
						refs.set(child.id, rchild._id);
					}
					delete obj.children;
				}
				if (obj.standalones) {
					for (const id of obj.standalones) {
						const kid = refs.get(id);
						if (!kid) {
							console.warn(
								`Missing child id: ${upgrader.reverseMap[id] ?? id}`
							);
						}
						children.push(kid);
					}
					delete obj.standalones;
				}
				const row = await site.$relatedQuery('children', trx)
					.insert(obj).returning('_id');
				if (children.length) {
					await Block.relatedQuery('children', trx).for(row._id).relate(children);
				}
				if (parents.length) {
					await Block.relatedQuery('parents', trx).for(row._id).relate(parents);
				}
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

		const errors = [];
		let error;

		for (let obj of list) {
			try {
				obj = await upgrader.process(obj);
				await afterEachStandalone(obj);
			} catch (err) {
				err.message = `${obj.id} ${obj.type}: ${err.message}`;
				if (err.name == "ValidationError") {
					errors.push(err.message);
				} else {
					error = err;
					break;
				}
			}
		}
		if (errors.length) {
			throw new HttpError.BadRequest(errors.join('\n'));
		}
		if (error) throw error;

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
			languages: {
				title: 'Import languages',
				type: 'boolean',
				default: true
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
