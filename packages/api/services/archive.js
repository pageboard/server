const { createReadStream, createWriteStream } = require('fs');
const Path = require('path');
const util = require('util');

const ndjson = require.lazy('ndjson');
const Upgrader = require.lazy('../upgrades');

const Deferred = require('../../../lib/deferred');

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
			req => 	req.run('archive.import', req.query)
		);
	}

	async export({ site, trx, res, Href }, data) {
		// TODO allow export of a selection of pages and/or standalones
		// (by types, by url, by id...)
		const id = site.id;
		const filepath = file ?? `${id}-${fileStamp()}.json`;
		const counts = {
			users: 0,
			blocks: 0,
			relations: 0,
			hrefs: 0,
			standalones: 0
		};

		let out;
		if (res.attachment) {
			counts.file = Path.basename(filepath);
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
		jstream.write(site);

		const blocks = await site.$relatedQuery('children', trx)
			.selectWithout('tsv', '_id')
			.withGraphFetched('[children.^(children),parents(users)]')
			.modifiers({
				children(q) {
					return q.select('id');
				},
				users(q) {
					return q.selectWithout('_id', 'tsv').where('type', 'user');
				}
			});
		const depthIds = {};
		function trav(b, d) {
			const id = b.id;
			if (id) depthIds[id] = Math.max(depthIds[id] || 0, d);
			for (const c of b.children) trav(c, d + 1);
		}
		trav({ children: blocks }, 0);

		blocks.sort((a, b) => {
			return depthIds[b.id] - depthIds[a.id];
		});
		const users = [];
		for (const block of blocks) {
			if (block.standalone) counts.standalones += 1;
			block.parents = block.parents.map(parent => {
				if (!users.some(item => item.id == parent.id)) {
					users.push(parent);
				}
				return parent.id;
			});
			if (block.parents.length == 0) delete block.parents;

			block.children = (block.children || []).map(item => item.id);
			const cLen = block.children.length;
			if (cLen == 0) {
				delete block.children;
			} else {
				counts.relations += cLen;
			}
		}
		counts.users = users.length;
		counts.blocks = blocks.length - counts.standalones;
		for (const user of users) jstream.write(user);
		for (const block of blocks) jstream.write(block);

		const hrefs = ids.length == 0
			? await Href.query(trx)
				.whereSite(site.id)
				.select()
			: await req.call('href.collect', {
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
				pattern: '^[\\w-]+\\.json$',
				nullable: true
			}
		}
	};

	async empty({ site, trx, Block }, data) {
		const q = site.$relatedQuery('children', trx)
			.select('_id')
			.where('standalone', true).as('children');
		if (data.types.length) q.whereIn('type', data.types);
		return Block.query(trx)
			.select(trx.raw('recursive_delete(children._id, TRUE)')).from(q);
		// TODO gc href ?
	}
	static empty = {
		title: 'Empty site',
		$action: 'write',
		properties: {
			types: {
				title: 'Types',
				description: 'Empty those types and their descendants',
				type: 'array',
				default: [],
				items: {
					type: 'string',
					format: 'name',
					$filter: {
						name: 'element',
						standalone: true,
						contentless: true
					}
				}
			}
		}
	};

	async import({ app, site, trx, Block }, data) {
		const counts = {
			users: 0,
			blocks: 0,
			relations: 0,
			hrefs: 0,
			standalones: 0
		};
		const fstream = createReadStream(Path.resolve(app.cwd, data.file))
			.pipe(ndjson.parse());

		let upgrader;
		const refs = {};
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
				const fromVersion = obj.data.server;
				Object.assign(obj.data, { domains: null }, data.data || {});
				upgrader = new Upgrader(Block, {
					copy: data.copy,
					from: fromVersion,
					to: obj.data.server
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
				// need to remove all blocks during import
				// FIXME use archive.empty
				await site.$relatedQuery('children', trx).select(trx.raw('recursive_delete(block._id, TRUE)'));
				await site.$relatedQuery('hrefs', trx).delete();
				await site.$query(trx).patch({ data: obj.data });
			} else if (obj.type == "user") {
				await upgrader.afterEach(obj);
				try {
					const user = await Block.query(trx).where('type', 'user')
						.whereJsonText('data:email', obj.data.email).select('_id', 'id')
						.first().throwIfNotFound();
					refs[obj.id] = user._id;
				} catch(err) {
					if (err.status != 404) throw err;
					const user = Block.query(trx).insert(obj).returning('_id', 'id');
					refs[obj.id] = user._id;
				}
				counts.users++;
			} else {
				await upgrader.afterEach(obj);
				if (obj.parents) {
					obj.parents = obj.parents.map(id => {
						const kid = refs[id];
						if (!kid) {
							throw new HttpError.BadRequest(
								`Missing parent id: ${upgrader.reverseMap[id] || id}`
							);
						}
						return { "#dbRef": kid };
					});
				}
				if (obj.children) {
					obj.children = obj.children.map(id => {
						const kid = refs[id];
						if (!kid) {
							throw new HttpError.BadRequest(
								`Missing child id: ${upgrader.reverseMap[id] || id}`
							);
						}
						return { "#dbRef": kid };
					});
				}
				const row = await site.$relatedQuery('children', trx)
					.insertGraph(obj, {
						allowRefs: true
					}).returning('_id');
				if (obj.standalone) counts.standalones += 1;
				else counts.blocks += 1;
				if (obj.children) counts.relations += obj.children.length;
				refs[obj.id] = row._id;
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
			obj = await upgrader.process(obj);
			try {
				await afterEach(obj);
			} catch (err) {
				err.message = (err.message || "") +
					`\nwhile processing ${util.inspect(obj, false, Infinity)}`;
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
			copy: {
				title: 'Generate new ids',
				type: 'boolean',
				default: true
			},
			data: {
				title: 'Data',
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
