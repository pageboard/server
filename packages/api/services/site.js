var lodashMerge = require('lodash.merge');
const {ref} = require('objection');
const {PassThrough} = require('stream');
const {createReadStream, createWriteStream} = require('fs');

exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
	All.app.put('/.api/site', All.auth.lock('webmaster'), function(req, res, next) {
		var data = Object.assign(req.body, {id: req.site.id});
		All.run('site.save', data).then(function(site) {
			res.send(site);
		}).catch(next);
	});
}

function QuerySite(data) {
	/* gets distinct typesin this site as json array
	.select(
		Block.query().from('block AS b')
			.select(raw('array_to_json(array_agg(distinct b.type))'))
			.join('relation as r', 'b._id', 'r.child_id')
			.where('r.parent_id', ref('site._id'))
			.as('types')
	)
	*/
	var Block = All.api.Block;
	var q = Block.query().alias('site')
	.first().throwIfNotFound()
	.where('site.type', 'site').where(function(q) {
		if (data.id) q.orWhere('site.id', data.id);
		if (data.domain) q.orWhereJsonHasAny('site.data:domains', data.domain);
	});
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select();
};

exports.get.schema = {
	$action: 'read',
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		domain: {
			type: 'string',
			format: 'hostname'
		}
	},
	anyOf: [{
		required: ['id']
	}, {
		required: ['domain']
	}]
};

exports.search = function(data) {
	var Block = All.api.Block;
	var q = Block.query().alias('site').select().where('site.type', 'site')
	.joinRelation('children', {alias: 'settings'})
	.where('settings.type', 'settings');
	if (data.grants) q.where(function(builder) {
		data.grants.forEach(function(grant) {
			builder.orWhereJsonSupersetOf('settings.data:grants', [grant]);
		});
	});
	return q.joinRelation('parents', {alias: 'user'})
	.where('user.type', 'user')
	.whereJsonText('user.data:email', data.email)
	.orderBy('site.updated_at', 'site.desc')
	.offset(data.offset)
	.limit(data.limit).then(function(rows) {
		var obj = {
			data: rows,
			offset: data.offset,
			limit: data.limit
		};
		obj.schemas = {
			site: Block.schema('site')
		};
		return obj;
	});
};
exports.search.schema = {
	$action: 'read',
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		grants: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
			}
		},
		limit: {
			type: 'integer',
			minimum: 0,
			maximum: 50,
			default: 10
		},
		offset: {
			type: 'integer',
			minimum: 0,
			default: 0
		}
	}
};

exports.add = function(data) {
	return QuerySite({id: data.id}).then(function(site) {
		console.info("There is already a site with this id", data.id);
	}).catch(function(err) {
		data.type = 'site';
		data.children = [{
			standalone: true, // this might not be needed
			type: 'page',
			data: {
				title: '404',
				url: '/.well-known/404',
				noindex: true,
				nositemap: true
			}
		}];
		return All.api.Block.query().insertGraph(data);
	});
};

exports.add.schema = {
	$action: 'add',
	required: ['id', 'data'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		data: {
			type: 'object'
		}
	}
};

exports.save = function(data) {
	if (data.data.domains === "") data.data.domains = null;
	if (data.data.version === "") data.data.version = null;
	return All.api.transaction(function(trx) {
		return exports.get(data).transacting(trx).forUpdate().then(function(site) {
			lodashMerge(site.data, data.data);
			return All.install(site).then(function(site) {
				return site.$query(trx).patchObject({
					type: site.type,
					data: data.data
				}).then(function() {
					return site;
				});
			});
		});
	});
};
exports.save.schema = {
	$action: 'save',
	required: ['id', 'data'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		data: {
			type: 'object',
			default: {}
		}
	}
};

exports.del = function(data) {
	var Block = All.api.Block;
	return All.api.transaction(function(trx) {
		var counts = {};
		return Block.query(trx).where('type', 'site').select('_id').where('id', data.id)
		.first().throwIfNotFound().then(function(site) {
			return Promise.all([
				Block.query(trx).whereIn(
					'_id',
					Block.query(trx)
					.where('block._id', site._id)
					.joinRelation('children.children', {alias: 'c'})
					.select('c._id')
				).del()
				.then(function(count) {
					counts.blocks = count;
					return Block.query(trx).whereIn(
						'_id',
						Block.query(trx)
						.where('block._id', site._id)
						.joinRelation('children', {alias: 'c'})
						.where('c.standalone', false)
						.select('c._id')
					).del();
				}).then(function(count) {
					counts.blocks += count;
					return Block.query(trx).whereIn(
						'_id',
						Block.query(trx)
						.where('block._id', site._id)
						.joinRelation('children', {alias: 'c'})
						.where('c.standalone', true)
						.select('c._id')
					).del();
				}).then(function(count) {
					counts.standalones = count;
					return site.$query(trx).del().then(function(count) {
						counts.site = count;
						return counts;
					});
				}),
				All.api.Href.query(trx).where('_parent_id', site._id).del().then(function(count) {
					counts.hrefs = count;
				})
			]);
		}).then(function() {
			return counts;
		});
	});
};
exports.del.schema = {
	$action: 'del',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		}
	}
};

// export all data but files
exports.export = function(data) {
	var counts = {
		site: 0,
		blocks: 0,
		standalones: 0,
		hrefs: 0,
		settings: 0
	};
	return exports.get(data).eager(`[children(lones)]`, {
		lones: function(builder) {
			return builder.select('_id').where('standalone', true).orderByRaw("data->>'url' IS NOT NULL");
		}
	}).then(function(site) {
		var children = site.children;
		delete site.children;
		var out = createWriteStream(data.file);
		var finished = new Promise(function(resolve, reject) {
			out.resolve = resolve;
			out.reject = reject;
		});
		out.once('finish', out.resolve);
		out.once('error', out.reject);
		counts.site = 1;
		counts.standalones = children.length;
		out.write('{"site": ');
		if (data.carbon) {
			out.write(JSON.stringify(site));
		} else {
			out.write(JSON.stringify({
				type: 'site',
				data: {
					module: site.data.module
				}
			}));
		}
		out.write(',\n"standalones": [');
		var last = children.length - 1;
		var prom = Promise.resolve();
		children.reduce(function(p, child, i) {
			return p.then(function() {
				return All.api.Block.query()
				.select().omit(['tsv', '_id'])
				.first().where('_id', child._id)
				.eager('[children(notlones) as children,children(lones) as standalones]', {
					notlones: function(builder) {
						return builder.select().omit(['tsv', '_id']).where('standalone', false);
					},
					lones: function(builder) {
						return builder.select('block.id').where('standalone', true);
					}
				}).then(function(lone) {
					if (lone.standalones.length > 0) {
						if (!lone.data || !lone.data.url) {
							console.warn("standalone block without url has standalone children", lone);
							delete lone.standalones;
						}
					} else {
						delete lone.standalones;
					}
					counts.blocks += lone.children.length;
					out.write(JSON.stringify(lone));
					if (i != last) out.write(',');
				});
			});
		}, prom).then(function() {
			out.write('],\n"hrefs": [');
			return All.api.Href.query().select()
			.omit(['tsv', '_id', '_parent_id']).whereSite(site.id).then(function(hrefs) {
				counts.hrefs = hrefs.length;
				var last = hrefs.length - 1;
				hrefs.forEach(function(href, i) {
					out.write(JSON.stringify(href));
					if (i != last) out.write(',');
				});
			});
		}).then(function() {
			// TODO extend to any non-standalone block that is child of user or settings
			// TODO fix calendar so that reservations are made against a user, not against its settings
			out.write(']');
			if (!data.settings) return;
			out.write(',\n"settings": [');
			return site.$relatedQuery('children').where('block.type', 'settings')
			.select().eager('parents(user) as user', {
				user: function(builder) {
					return builder.select(
						ref('data:email').castText().as('email')
					).where('block.type', 'user');
				}
			}).joinRelation('parents', {alias: 'site'})
			.where('site.type', 'site').then(function(settings) {
				var last = settings.length - 1;
				settings.forEach(function(setting, i) {
					var user = setting.user;
					delete setting.user;
					if (user.length == 0) return;
					user = user[0];
					if (!user.email) return;
					counts.settings++;
					setting._email = user.email;
					out.write(JSON.stringify(setting));
					if (i != last) out.write(',');
				});
			}).then(function() {
				out.write(']');
			});
		}).then(function() {
			out.end('}');
			return counts;
		});
		return prom.then(function() {
			return finished;
		});
	});
};
exports.export.schema = {
	$action: 'read',
	required: ['id', 'file'],
	properties: {
		id: {
			title: 'Site id',
			type: 'string',
			format: 'id'
		},
		file: {
			type: 'string'
		},
		settings: {
			type: 'boolean',
			default: false
		},
		carbon: {
			type: 'boolean',
			default: false
		}
	}
};

// import all data but files
exports.import = function(data) {
	var Block = All.api.Block;
	var counts = {
		site: 0,
		blocks: 0,
		standalones: 0,
		settings: 0,
		users: 0
	};
	return All.api.transaction(function(trx) {
		var p = Promise.resolve();
		const fstream = createReadStream(data.file);
		const pstream = new PassThrough({
			objectMode: true,
			highWaterMark: 1
		});
		var site;
		var standalones = {};
		var oldmap = {};
		pstream.on('data', function(obj) {
			p = p.then(function() {
				if (obj.site) {
					obj.site.id = data.id;
					return Block.query(trx).insert(obj.site).returning('*').then(function(copy) {
						counts.site++;
						site = copy;
					});
				} else if (obj.lone) {
					var lone = obj.lone;
					var map = {};
					return Promise.all([
						Block.genId().then(function(id) {
							var old = lone.id;
							lone.id = id;
							oldmap[old] = id;
							map[id] = new RegExp(`block-id="${old}"`, 'g');
						})
					].concat(lone.children.map(function(child) {
						return Block.genId().then(function(id) {
							var old = child.id;
							child.id = id;
							map[id] = new RegExp(`block-id="${old}"`, 'g');
						});
					}))).then(function() {
						var lones = lone.standalones;
						var lonesRefs = [];
						if (lones) {
							delete lone.standalones;
							lones.forEach(function(rlone) {
								// relate lone to rlone
								var id = oldmap[rlone.id];
								if (!id) {
									throw new Error("unknown standalone " + rlone.id);
								}
								map[id] = new RegExp(`block-id="${rlone.id}"`, 'g');
								var _id = standalones[id];
								if (!_id) {
									console.error(rlone, id);
									throw new Error("standalone not yet inserted " + rlone.id);
								}
								lonesRefs.push({
									"#dbRef": _id
								});
							});
						}
						lone.children.forEach(function(child) {
							replaceContent(map, child);
							child.parents = [{
								"#dbRef": site._id
							}];
						});
						lone.children = lone.children.concat(lonesRefs);
						replaceContent(map, lone);
					}).then(function() {
						return site.$relatedQuery('children', trx).insertGraph(lone).then(function(obj) {
							standalones[lone.id] = obj._id;
							counts.standalones++;
							counts.blocks += lone.children.length;
						});
					});
				} else if (obj.href) {
					var href = obj.href;
					if (href.pathname) {
						href.pathname = href.pathname.replace(/\/uploads\/[^/]+\//, `/uploads/${site.id}/`);
					}
					counts.hrefs++;
					return site.$relatedQuery('hrefs', trx).insert(href).catch(function(err) {
						console.error(err, href);
						throw err;
					});
				} else if (obj.setting) {
					var setting = obj.setting;
					return Block.query(trx).where('type', 'user')
					.whereJsonText('data:email', setting._email).select('_id')
					.first().throwIfNotFound()
					.catch(function(err) {
						if (err.status != 404) throw err;
						counts.users++;
						return Block.query(trx).insert({
							data: { email: setting._email },
							type: 'user'
						}).returning('_id');
					}).then(function(user) {
						return Block.genId().then(function(id) {
							setting.id = id;
							setting.parents = [{'#dbRef': user._id}];
							counts.settings++;
							delete setting._email;
							return site.$relatedQuery('children', trx).insertGraph(setting);
						});
					});
				}
			});
		});

		const jstream = require('oboe')(fstream);
		jstream.node('!.site', function(data) {
			pstream.write({site: data});
		});
		jstream.node('!.standalones[*]', function(data) {
			pstream.write({lone: data});
		});
		jstream.node('!.hrefs[*]', function(data) {
			pstream.write({href: data});
		});
		jstream.node('!.settings[*]', function(data) {
			pstream.write({setting: data});
		});
		jstream.on('end', function() {
			pstream.end();
		});
		jstream.on('fail', function(failObj) {
			pstream.emit('error', failObj);
		});

		var q = new Promise(function(resolve, reject) {
			pstream.on('error', function(err) {
				reject(err);
			});
			pstream.on('finish', function() {
				resolve();
			});
		});
		return q.then(function() {
			return p;
		}).then(function() {
			return counts;
		});
	});
};
exports.import.schema = {
	$action: 'write',
	required: ['id', 'file'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		file: {
			type: 'string'
		}
	}
};

function replaceContent(map, block) {
	if (!block.content) return;
	if (typeof block.content != "object") {
		console.error(block);
		throw new Error("content not object");
	}
	Object.entries(block.content).forEach(function([key,str]) {
		if (!str) return;
		for (var id in map) {
			str = str.replace(map[id], `block-id="${id}"`);
		}
		block.content[key] = str;
	});
}

exports.gc = function() {
	// deletes all blocks that belong to no site
	return All.api.Href.raw(`DELETE FROM block
WHERE block.type NOT IN ('site', 'user') AND NOT EXISTS (SELECT c._id FROM block c, relation r, block p
WHERE c._id = block._id AND r.child_id = c._id AND p._id = r.parent_id AND p.type IN ('site', 'user')
GROUP BY c._id HAVING count(*) >= 1)`);
};
