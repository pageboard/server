const { createReadStream, createWriteStream } = require('fs');
const Path = require('path');

const ndjson = require.lazy('ndjson');
const Upgrader = require.lazy('../upgrades');

exports = module.exports = function (opt) {
	return {
		name: 'archive',
		service: init
	};
};

function init(All) {
	All.app.get('/.api/archive', All.auth.lock('webmaster'), (req, res, next) => {
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

	return site.$relatedQuery('children', trx).selectWithout('tsv', '_id').withGraphJoined('[parents(parents)]').modifiers({
		parents(q) {
			return q.selectWithout('tsv', '_id').whereNot('block.id', site.id);
		}
	}).then(blocks => {
		// child without parents first, parents before children
		blocks.sort((a, b) => {
			if (a.id == b.id) return 0;
			if (a.parents.length == 0) return -1;
			else if (a.parents.find(p => p.id == b.id)) return 1;
			else return -1;
		});
		// users are not children of site
		const users = [];
		for (const block of blocks) {
			// keep only id
			if (block.standalone) counts.standalones += 1;
			if (block.parents) block.parents = block.parents.map(p => {
				if (!blocks.find(b => b.id == p.id)) {
					if (p.type == "user") {
						users.push(p);
					} else {
						console.warn("parent is an orphan of unsupported type:", p);
					}
				}
				return p.id;
			});
			const len = block.parents.length;
			if (len == 0) {
				delete block.parents;
			} else {
				counts.relations += len;
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
exports.import = function ({site, trx}, data) {
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
	let p = Promise.resolve();
	const fstream = createReadStream(Path.resolve(All.opt.cwd, data.file)).pipe(ndjson.parse());

	let upgrader;
	let hadError = false;
	const errorStop = (obj) => {
		return (err) => {
			if (!hadError) {
				console.error("Error importing", obj, err);
				hadError = true;
				throw err;
			}
		};
	};
	const refs = {};
	fstream.on('data', (obj) => {
		if (!obj.id) {
			p = p.then(() => {
				if (obj.pathname) {
					obj.pathname = obj.pathname.replace(/\/uploads\/[^/]+\//, `/uploads/${site.id}/`);
				}
				counts.hrefs++;
				return site.$relatedQuery('hrefs', trx).insert(obj);
			}).catch(errorStop(obj));
		} else if (obj.type == "site") {
			if (!obj.data) obj.data = {};
			const fromVersion = obj.data.server;
			Object.assign(obj.data, { domains: null }, data.data || {});
			upgrader = new Upgrader(Block, {
				copy: data.copy,
				from: fromVersion,
				to: obj.data.server
			});
			upgrader.process(obj);
			upgrader.finish(obj);
			// need to remove all blocks during import
			p = p.then(() => {
				// FIXME use archive.empty
				return Block.query(trx)
					.select(trx.raw('recursive_delete(children._id, TRUE)')).from(
						site.$relatedQuery('children', trx).select('block._id').as('children')
					);
			}).then(() => {
				return site.$relatedQuery('hrefs', trx).delete();
			}).then(() => {
				return site.$query(trx).patch({ data: obj.data });
			}).catch(errorStop(obj));
		} else if (obj.type == "user") {
			// FIXME user cannot change its id
			// obj = upgrader.process(obj);
			p = p.then(() => {
				return Block.query(trx).where('type', 'user')
					.whereJsonText('data:email', obj.data.email).select('_id', 'id')
					.first().throwIfNotFound()
					.catch((err) => {
						if (err.status != 404) throw err;
						return Block.query(trx).insert(obj).returning('_id, id');
					}).then(user => {
						counts.users++;
						// upgrader.finish(obj);
						refs[obj.id] = user._id;
					});
			}).catch(errorStop(obj));
		} else {
			obj = upgrader.process(obj);
			if (obj.parents) {
				obj.parents = obj.parents.map(id => {
					const pid = refs[id];
					if (!pid) console.warn("Missing parent_id", id, obj);
					return { "#dbRef": refs[id] };
				});
			}
			p = p.then(() => {
				return site.$relatedQuery('children', trx).insertGraph(obj, {
					allowRefs: true
				}).returning('_id').then(row => {
					if (obj.standalone) counts.standalones += 1;
					else counts.blocks += 1;
					if (obj.parents) counts.relations += obj.parents.length;
					upgrader.finish(obj);
					refs[obj.id] = row._id;
				});
			}).catch(errorStop(obj));
		}
	});

	const q = new Promise((resolve, reject) => {
		fstream.on('error', (err) => {
			reject(err);
		});
		fstream.on('finish', () => {
			resolve();
		});
	});
	return q.then(() => {
		return p;
	}).then(() => {
		//return Promise.all(mp);
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
