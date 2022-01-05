const { ref, raw } = require('objection');
const { PassThrough } = require('stream');
const { createReadStream, createWriteStream } = require('fs');
const Upgrader = require('../upgrades');

const Path = require('path');

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

// export all data but files
exports.export = function ({site, trx}, data) {
	// TODO allow export of a selection of pages and/or standalones (by types, by url, by id...)
	const id = site.id;
	const filepath = data.file || (id + '-' + (new Date()).toISOString().split('.')[0].replace(/[-:]/g, '').replace('T', '-').slice(0, -2) + '.json');
	const counts = {
		site: 0,
		blocks: 0,
		standalones: 0,
		hrefs: 0,
		settings: 0,
		reservations: 0
	};

	return site.$relatedQuery('children', trx)
		.select('_id').where('standalone', true).orderByRaw("data->>'url' IS NOT NULL").then((children) => {
		const out = req.res || createWriteStream(Path.resolve(All.opt.cwd, filepath));
		if (req.res) req.res.attachment(Path.basename(filepath));
		const finished = new Promise((resolve, reject) => {
			out.resolve = resolve;
			out.reject = reject;
		});
		out.once('finish', out.resolve);
		out.once('error', out.reject);
		counts.site = 1;
		counts.standalones = children.length;
		out.write('{"site": ');
		out.write(toJSON(site));
		// TODO extend to any non-standalone block that is child of user or settings
		// TODO fix calendar so that reservations are made against a user, not against its settings
		out.write(',\n"settings": [');
		return site.$relatedQuery('children', trx).where('block.type', 'settings')
			.select().withGraphFetched('[parents(user) as user]').modifiers({
				user(builder) {
					return builder.select(
						ref('data:email').castText().as('email')
					).where('block.type', 'user');
				}
			}).joinRelated('parents', { alias: 'site' })
			.where('site.type', 'site').then((settings) => {
				const last = settings.length - 1;
				settings.forEach((setting, i) => {
					let user = setting.user;
					delete setting.user;
					if (user.length == 0) return;
					user = user[0];
					if (!user.email) return;
					counts.settings++;
					setting._email = user.email;
					out.write(toJSON(setting));
					if (i != last) out.write('\n,');
				});
			}).then(() => {
				out.write(']');
			}).then(() => {
				out.write(',\n"standalones": [');
				const last = children.length - 1;
				let p = Promise.resolve();
				const list = [];
				children.forEach((child) => {
					p = p.then(() => {
						return All.api.Block.query(trx)
							.selectWithout('tsv', '_id')
							.first().where('_id', child._id)
							.withGraphFetched('[children(notlones) as children,children(lones) as standalones]')
							.modifiers({
								notlones(builder) {
									return builder.selectWithout('tsv', '_id').where('standalone', false);
								},
								lones(builder) {
									return builder.select('block.id')
										.where('standalone', true)
										.orderByRaw("block.data->>'url' IS NOT NULL ASC");
								}
							}).then((lone) => {
								if (lone.standalones.length == 0) {
									delete lone.standalones;
									list.unshift(lone);
								} else {
									list.push(lone);
								}
								counts.blocks += lone.children.length;
							});
					});
				});
				return p.then(() => {
					list.forEach((lone, i) => {
						out.write(toJSON(lone));
						if (i != last) out.write('\n,');
					});
				});
			}).then(() => {
				out.write('],\n"reservations": [');
			}).then(() => {
				return site.$relatedQuery('children', trx).where('block.type', 'event_reservation')
					.select().withGraphFetched('parents(notsite) as parents').modifiers({
						notsite(builder) {
							return builder.select('block.id', 'block.type')
								.whereIn('block.type', ['settings', 'event_date'])
								.orderBy('block.type');
						}
					}).then((reservations) => {
						const last = reservations.length - 1;
						reservations.forEach((resa, i) => {
							counts.reservations++;
							out.write(toJSON(resa));
							if (i != last) out.write('\n,');
						});
					});
			}).then(() => {
				out.write('],\n"hrefs": [');
				return All.api.Href.query(trx).selectWithout('tsv', '_id', '_parent_id')
					.whereSite(site.id).then((hrefs) => {
						counts.hrefs = hrefs.length;
						const last = hrefs.length - 1;
						hrefs.forEach((href, i) => {
							out.write(JSON.stringify(href));
							if (i != last) out.write('\n,');
						});
					});
			}).then(() => {
				out.write(']');
			}).then(() => {
				out.end('}');
				return finished;
			});
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

// import all data but files
exports.import = function ({site, trx}, data) {
	// TODO use multer to preprocess request stream into a temporary data.file = req.files[0] if any
	// TODO allow import of partial extracts (like some pages and standalones without site nor settings)
	const Block = All.api.Block;
	const counts = {
		site: 0,
		blocks: 0,
		standalones: 0,
		settings: 0,
		users: 0,
		hrefs: 0,
		reservations: 0
	};
	let p = Promise.resolve();
	const fstream = createReadStream(Path.resolve(All.opt.cwd, data.file));
	const pstream = new PassThrough({
		objectMode: true,
		highWaterMark: 1
	});
	const queues = {};
	const mp = [];
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
	pstream.on('data', (obj) => {
		if (obj.site) {
			if (!obj.site.data) obj.site.data = {};
			const fromVersion = obj.site.data.server;
			Object.assign(obj.site.data, { domains: null }, data.data || {});
			upgrader = new Upgrader(Block, {
				copy: data.copy,
				from: fromVersion,
				to: obj.site.data.server
			});
			upgrader.process(obj.site);
			upgrader.finish(obj.site);
			// need to remove all blocks during import
			p = p.then(() => {
				return Block.query(trx)
					.select(trx.raw('recursive_delete(children._id, TRUE)')).from(
						site.$relatedQuery('children', trx).select('block._id').as('children')
					);
			}).then(() => {
				return site.$relatedQuery('hrefs', trx).delete();
			}).then(() => {
				return site.$query(trx).patch({ data: obj.site.data }).then(() => {
					counts.site++;
				});
			}).catch(errorStop(obj.site));
		} else if (obj.lone) {
			const lone = upgrader.process(obj.lone, site);
			let doneLone;
			queues[lone.id] = new Promise((resolve) => {
				doneLone = resolve;
			});
			const lonesRefs = [];
			mp.push(p.then(() => {
				const lones = lone.standalones;
				if (!lones) return;
				delete lone.standalones;
				return Promise.all(lones.map((rlone) => {
					// relate lone to rlone
					const id = upgrader.get(rlone.id);
					if (!id) throw new Error("unknown standalone " + rlone.id);
					return queues[id].then((_id) => {
						lonesRefs.push({
							"#dbRef": _id
						});
					});
				}));
			}).then(() => {
				lone.children.forEach((child) => {
					child.parents = [{
						"#dbRef": site._id
					}];
				});
				upgrader.finish(lone);
				lone.children = lone.children.concat(lonesRefs);
				return site.$relatedQuery('children', trx).insertGraph(lone, {
					allowRefs: true
				}).then((obj) => {
					counts.standalones++;
					counts.blocks += lone.children.length;
					doneLone(obj._id);
				})
			}).catch(errorStop(lone)));
		} else if (obj.href) {
			const href = obj.href;
			p = p.then(() => {
				if (href.pathname) {
					href.pathname = href.pathname.replace(/\/uploads\/[^/]+\//, `/uploads/${site.id}/`);
				}
				counts.hrefs++;
				return site.$relatedQuery('hrefs', trx).insert(href);
			}).catch(errorStop(href));
		} else if (obj.setting) {
			const setting = upgrader.process(obj.setting, site);
			p = p.then(() => {
				upgrader.finish(setting);
				return Block.query(trx).where('type', 'user')
					.whereJsonText('data:email', setting._email).select('_id')
					.first().throwIfNotFound()
					.catch((err) => {
						if (err.status != 404) throw err;
						counts.users++;
						return Block.query(trx).insert({
							data: { email: setting._email },
							type: 'user'
						}).returning('_id');
					}).then((user) => {
						setting.parents = [{ '#dbRef': user._id }];
						counts.settings++;
						delete setting._email;
						return site.$relatedQuery('children', trx).insertGraph(setting);
					});
			}).catch(errorStop(setting));
		} else if (obj.reservation) {
			const resa = upgrader.process(obj.reservation, site);
			p = p.then(() => {
				upgrader.finish(resa);
				const parents = resa.parents || [];
				if (parents.length != 2) {
					console.warn("Ignoring reservation", resa);
					return;
				}
				// get settings, date
				return site.$relatedQuery('children', trx)
					.select('_id')
					.whereIn('block.id', parents.map((parent) => {
						return parent.id;
					})).then((parents) => {
						resa.parents = parents.map((parent) => {
							return { "#dbRef": parent._id };
						});
					}).then(() => {
						counts.reservations++;
						return site.$relatedQuery('children', trx).insertGraph(resa, {
							allowRefs: true
						});
					});
			}).catch(errorStop(resa));
		}
		p.catch((ex) => {
			pstream.emit('error', ex);
			throw ex;
		});
	});

	const jstream = require('oboe')(fstream);
	jstream.node('!.site', (data) => {
		pstream.write({ site: data });
	});
	jstream.node('!.standalones[*]', (data) => {
		pstream.write({ lone: data });
	});
	jstream.node('!.hrefs[*]', (data) => {
		pstream.write({ href: data });
	});
	jstream.node('!.settings[*]', (data) => {
		pstream.write({ setting: data });
	});
	jstream.node('!.reservations[*]', (data) => {
		pstream.write({ reservation: data });
	});
	jstream.on('end', () => {
		pstream.end();
	});
	jstream.on('fail', (failObj) => {
		pstream.emit('error', failObj);
	});

	const q = new Promise((resolve, reject) => {
		pstream.on('error', (err) => {
			reject(err);
		});
		pstream.on('finish', () => {
			resolve();
		});
	});
	return q.then(() => {
		mp.unshift(p);
		return Promise.all(mp);
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


function toJSON(obj) {
	return JSON.stringify(obj, null, " ");
}


