const Path = require('node:path');
const { createReadStream, createWriteStream, promises: fs } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const utils = require('../../../src/utils');
const ndjson = require('ndjson');
const Upgrader = require('../upgrades');
const Archiver = require('archiver');

module.exports = class ArchiveService {
	static name = 'archive';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(router) {
		router.read('/archive/export', 'archive.export');
		router.write('/archive/import', 'archive.import');
	}

	async bundle(req, data) {
		const { hrefs, items, item } = await req.run('apis.get', {
			name: data.name,
			query: data.query,
			hrefs: true
		});
		const counts = {
			blocks: items?.length ?? 0 + (item ? 1 : 0),
			hrefs: 0,
			files: 0,
			skips: []
		};

		const lastUpdate = Math.max(item?.updated_at, ...items.map(item => {
			return item.updated_at;
		}));
		const archivePath = await archiveWrap(req, data.format, async archive => {
			const buf = [];
			const obj = { hrefs };
			if (items) obj.items = items;
			if (item) obj.item = item;
			const json = JSON.stringify(data.hrefs ? obj : items ?? item);
			if (!data.version) buf.push(json);
			archive.append(json, {
				name: 'export.json',
				date: lastUpdate
			});
			const list = Object.entries(hrefs).map(
				([url, { mime }]) => {
					if (!data.version) buf.push(url);
					return { url, mime };
				}
			);

			counts.hrefs += list.length;
			await this.#archiveFiles(req, archive, list, counts, data);
			return [data.name, data.version ?? utils.hash(buf)].join('-');
		});
		counts.file = req.call('statics.url', archivePath);
		return counts;
	}
	static bundle = {
		title: 'Bundle by fetch',
		$action: 'read',
		$lock: 'webmaster',
		$cache: false,
		required: ['name'],
		properties: {
			format: {
				title: 'Archive format',
				anyOf: [
					{ const: 'zip', title: 'Zip' },
					{ const: 'tar', title: 'Tar' },
				],
				default: 'zip'
			},
			name: {
				title: 'Fetch name',
				type: 'string',
				format: 'name'
			},
			query: {
				title: 'Fetch query',
				type: 'object',
				nullable: true
			},
			version: {
				title: 'Version',
				type: 'string',
				format: 'singleline',
				nullable: true
			},
			size: {
				title: 'Resource size',
				$ref: "#/definitions/image.get/properties/parameters/properties/size"
			},
			hrefs: {
				title: 'Metadata of hrefs',
				type: 'boolean',
				default: false
			}
		}
	};

	async export(req, data) {
		const { site, sql: { ref, fun, trx } } = req;
		const lang = site.data.languages?.length == 0 ? site.data.lang : null;
		const urls = data.urls;
		const ids = (data.ids ?? []).slice();
		const counts = {
			users: 0,
			blocks: 0,
			hrefs: 0,
			files: 0,
			skips: [],
			orphaned: 0
		};

		const archivePath = await archiveWrap(req, data.format, async archive => {
			if (urls?.length) {
				const urlIds = await site.$relatedQuery('children', trx)
					.select('block.id')
					.whereIn('block.type', Array.from(site.$pkg.pages))
					.whereJsonText('block.data:url', 'IN', urls);
				ids.push(...urlIds.map(item => item.id));
			}
			const { orphaned } = await req.run('site.gc', { days: 0 });
			counts.orphaned = orphaned;

			const nsite = site.toJSON();
			delete nsite.data.domains;
			const jstream = ndjson.stringify();
			archive.append(jstream, {
				name: 'export.ndjson',
				date: site.updated_at
			});
			jstream.write(nsite);

			const colOpts = {
				lang,
				content: lang ? null : []
			};

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
				if (ids.length) {
					const contents = await site.$relatedQuery('children', trx)
						.with('parents', site.$relatedQuery('children', trx)
							.select('children._id')
							.joinRelated('parents')
							.joinRelated('children')
							.whereNot('parents.type', 'site')
							.whereIn('parents.id', ids)
							.select(fun('array_agg', ref('block.id')).as('parents'))
							.groupBy('children._id')
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
			}
			if (data.hrefs) {
				const list = await req.run('href.collect', {
					ids,
					content: true
				});
				counts.hrefs = list.length;
				for (const href of list) {
					jstream.write(href);
				}
				if (data.files) {
					await this.#archiveFiles(req, archive, list, counts, { size: null });
				}
			}
			jstream.end();

			return [site.id, fileStamp()].join('-');
		});
		counts.file = req.call('statics.url', archivePath);
		return counts;
	}
	static export = {
		title: 'Export site',
		$action: 'read',
		$lock: 'webmaster',
		$cache: false,
		properties: {
			format: {
				title: 'Archive format',
				anyOf: [
					{ const: 'zip', title: 'Zip' },
					{ const: 'tar', title: 'Tar' },
				],
				default: 'zip'
			},
			ids: {
				title: 'List of id',
				type: 'array',
				items: {
					type: "string",
					format: 'id'
				}
			},
			urls: {
				title: 'List of url',
				type: 'array',
				items: {
					type: "string",
					format: 'page'
				}
			},
			hrefs: {
				title: 'Includes hrefs',
				type: 'boolean',
				default: true
			},
			files: {
				title: 'Include files',
				type: 'boolean',
				default: false
			}
		}
	};

	async import(req, { file, reset, idMap, excludes = [] }) {
		// TODO import zip file with export.ndjson
		const types = excludes;
		const { sql: { trx, Block } } = req;
		let { site } = req;
		const counts = {
			users: 0,
			blocks: 0,
			contents: 0,
			hrefs: 0,
			langs: {
				in: new Set(),
				out: new Set()
			}
		};
		const { orphaned } = await req.run('site.gc', { days: 0 });
		counts.orphaned = orphaned;
		const fstream = createReadStream(Path.resolve(this.app.cwd, file))
			.pipe(ndjson.parse());

		let upgrader;
		const refs = new Map();

		const list = [];
		const beforeEachStandalone = obj => {
			if (obj.type && types.includes(obj.type)) return;
			if (obj.type == "site" || list.length == 0) {
				upgrader = new Upgrader({
					site,
					idMap,
					excludes
				});
			} else if (!obj.id) {
				return obj;
			}
			return upgrader.beforeEach(obj);
		};
		const afterEachStandalone = async obj => {
			if (obj.type && types.includes(obj.type)) return;
			if (!obj.id) {
				counts.hrefs++;
				return site.$relatedQuery('hrefs', trx).insert(obj).onConflict(['_parent_id', 'url']).ignore();
			} else if (obj.type == "site") {
				if (reset) {
					await req.run('site.empty', { id: req.site.id });
					const data = {};
					for (const key of reset) {
						if (obj.data[key] != null) data[key] = obj.data[key];
					}
					site = await req.run('site.save', data);
					upgrader.DomainBlock = site.$modelClass;
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
							console.warn(
								`Missing parent id: ${upgrader.reverseMap[id] ?? id}`
							);
						} else {
							parents.push(kid);
						}
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
						} else {
							children.push(kid);
						}
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
				if (obj.type == "content") counts.contents += 1;
				else counts.blocks += 1;
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
				if (!obj) continue;
				if (obj.type && obj.id) obj = await upgrader.process(obj);
				if (obj) await afterEachStandalone(obj);
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

		counts.langs.in = Array.from(counts.langs.in);
		counts.langs.out = Array.from(counts.langs.out);

		return counts;
	}

	static import = {
		title: 'Import site',
		$action: 'write',
		$lock: 'webmaster',
		$tags: ['data-:site'],
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
			reset: {
				title: 'Erase all and import these site.data properties',
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				}
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

	async #archiveFiles(req, archive, hrefs, counts, { size }) {
		for (const { url, mime } of hrefs) {
			if (url.startsWith('/@file/')) {
				let filePath;
				if (req.sql.Href.isImage(mime)) {
					filePath = await req.run('image.get', {
						url, size
					});
				} else {
					filePath = req.call('statics.path', url);
				}
				if (!filePath) {
					counts.skips.push(url);
				} else {
					const name = url.substring(1);
					archive.file(filePath, { name });
					counts.files++;
				}
			}
		}
	}
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

async function archiveWrap(req, format, fn) {
	const archive = new Archiver(format);
	archive.on('warning', err => {
		if (err.code === 'ENOENT') {
			console.warn(err);
		} else {
			throw err;
		}
	});

	const pubDir = req.call('statics.dir', 'cache');
	await fs.mkdir(pubDir, { recursive: true });
	const filename = await fn(archive);
	const filePath = Path.join(pubDir, `${filename}.${format}`);
	const d = pipeline(archive, createWriteStream(filePath));
	await archive.finalize();
	await d;
	return filePath;
}


