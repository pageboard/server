const { createReadStream, createWriteStream } = require('fs');
const Path = require('path');
const util = require('util');

const ndjson = require.lazy('ndjson');
const Upgrader = require.lazy('../upgrades');

exports = module.exports = function (opt) {
	return {
		name: 'archive',
		service: init
	};
};

function init(All) {
	All.app.get('/.api/archive', All.cache.disable, All.auth.lock('webmaster'), (req, res, next) => {
		return All.run('archive.export', req, req.query);
	});
	All.app.put('/.api/archive', All.auth.lock('webmaster'), (req, res, next) => {
		// TODO process req.files with multer
		return All.run('archive.import', req, req.query);
	});
}

exports.export = function ({ site, trx, res }, data) {
	// TODO allow export of a selection of pages and/or standalones (by types, by url, by id...)
	const id = site.id;
	const filepath = data.file || (id + '-' + (new Date()).toISOString().split('.')[0].replace(/[-:]/g, '').replace('T', '-').slice(0, -2) + '.json');
	const counts = {
		users: 0,
		blocks: 0,
		relations: 0,
		hrefs: 0,
		standalones: 0
	};

	const out = res || createWriteStream(Path.resolve(All.opt.cwd, filepath));
	if (res) res.attachment(Path.basename(filepath));
	const finished = new Promise((resolve, reject) => {
		out.resolve = resolve;
		out.reject = reject;
	});
	out.once('finish', out.resolve);
	out.once('error', out.reject);
	const jstream = ndjson.stringify();
	jstream.pipe(out);
	jstream.write(site);

	const query = site.$relatedQuery('children', trx)
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
	return query.then(blocks => {
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
	}).then(() => {
		const q = All.api.Href.query(trx).whereSite(site.id);
		return q.selectWithout('tsv', '_id', '_parent_id').then((hrefs) => {
			counts.hrefs = hrefs.length;
			for (const href of hrefs) {
				jstream.write(href);
			}
		});
	}).then(() => {
		jstream.end();
		return finished;
	}).then(() => {
		return counts;
	});
};
exports.export.schema = {
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

exports.empty = function ({ site, trx }, data) {
	const q = site.$relatedQuery('children', trx)
		.select('_id')
		.where('standalone', true).as('children');
	if (data.types.length) q.whereIn('type', data.types);
	return All.api.Block.query(trx)
		.select(trx.raw('recursive_delete(children._id, TRUE)')).from(q);
	// TODO gc href ?
};
exports.empty.schema = {
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

// import all data but files
exports.import = function ({ site, trx }, data) {
	// TODO use multer to preprocess request stream into a temporary data.file = req.files[0] if any
	// TODO allow import of partial extracts (like some pages and standalones without site nor settings)
	const Block = All.api.Block;
	const counts = {
		users: 0,
		blocks: 0,
		relations: 0,
		hrefs: 0,
		standalones: 0
	};
	const fstream = createReadStream(Path.resolve(All.opt.cwd, data.file)).pipe(ndjson.parse());

	let upgrader;
	const refs = {};
	const beforeEach = (obj) => {
		if (!obj.id) {
			if (obj.pathname) {
				obj.pathname = obj.pathname.replace(/\/uploads\/[^/]+\//, `/uploads/${site.id}/`);
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
	const afterEach = (obj) => {
		if (!obj.id) {
			counts.hrefs++;
			return site.$relatedQuery('hrefs', trx).insert(obj);
		} else if (obj.type == "site") {
			upgrader.afterEach(obj);
			// need to remove all blocks during import
			// FIXME use archive.empty
			return site.$relatedQuery('children', trx).select(trx.raw('recursive_delete(block._id, TRUE)')).then(children => {
				return site.$relatedQuery('hrefs', trx).delete();
			}).then(() => {
				return site.$query(trx).patch({ data: obj.data });
			});
		} else if (obj.type == "user") {
			upgrader.afterEach(obj);
			return Block.query(trx).where('type', 'user')
				.whereJsonText('data:email', obj.data.email).select('_id', 'id')
				.first().throwIfNotFound()
				.catch((err) => {
					if (err.status != 404) throw err;
					return Block.query(trx).insert(obj).returning('_id', 'id');
				}).then(user => {
					counts.users++;
					refs[obj.id] = user._id;
				});
		} else {
			upgrader.afterEach(obj);
			if (obj.parents) {
				obj.parents = obj.parents.map(id => {
					const kid = refs[id];
					if (!kid) throw new HttpError.BadRequest(`Missing parent id: ${upgrader.reverseMap[id] || id}`);
					return { "#dbRef": kid };
				});
			}
			if (obj.children) {
				obj.children = obj.children.map(id => {
					const kid = refs[id];
					if (!kid) throw new HttpError.BadRequest(`Missing child id: ${upgrader.reverseMap[id] || id}`);
					return { "#dbRef": kid };
				});
			}
			return site.$relatedQuery('children', trx).insertGraph(obj, {
				allowRefs: true
			}).returning('_id').then(row => {
				if (obj.standalone) counts.standalones += 1;
				else counts.blocks += 1;
				if (obj.children) counts.relations += obj.children.length;
				refs[obj.id] = row._id;
			});
		}
	};

	const list = [];
	fstream.on('data', (obj) => {
		list.push(beforeEach(obj));
	});

	let p = new Promise((resolve, reject) => {
		fstream.on('error', (err) => {
			reject(err);
		});
		fstream.on('finish', () => {
			resolve();
		});
	});
	let error;
	return p.then(() => {
		for (let obj of list) {
			obj = upgrader.process(obj);
			p = p.then(() => {
				if (error) return;
				return afterEach(obj).catch(err => {
					error = err;
					error.message = (error.message || "") + `\nwhile processing ${util.inspect(obj, false, Infinity)}`;
				});
			});
		}
		return p;
	}).then(() => {
		if (error) throw error;
	}).then(() => {
		return counts;
	});
};
exports.import.schema = {
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
