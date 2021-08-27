const { ref, raw } = require('objection');
const URL = require('url');

exports = module.exports = function (opt) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.get('/.api/page', function (req, res, next) {
		const site = req.site;
		const isWebmaster = !All.auth.locked(req, ['webmaster']);
		const dev = req.query.develop == "write";
		delete req.query.develop;
		if (isWebmaster && !dev) {
			All.send(res, {
				item: {
					type: 'write',
					data: {}
				},
				meta: Object.assign({ services: site.$services }, site.$bundles.write.meta),
				site: site.data
			});
		} else {
			All.run('page.get', req, req.query).then(function (data) {
				const resources = site.$bundles.write.meta.resources;
				if (dev && resources.develop) {
					if (!data.meta) data.meta = { scripts: [] };
					if (site.$bundles.user) {
						data.meta.scripts.unshift(site.$bundles.user.meta.bundle);
					}
					data.meta.scripts.unshift(resources.develop);
					data.meta.writes = {
						scripts: [resources.editor, resources.readScript],
						stylesheets: [resources.readStyle]
					};
				}
				All.send(res, data);
			}).catch(next);
		}
	});
	All.app.get('/.api/pages', function (req, res, next) {
		const isWebmaster = !All.auth.locked(req, ['webmaster']);
		if (isWebmaster) {
			// webmaster want to see those anyway
			// this must not be confused with page.lock
			req.query.drafts = true;
			if (!req.query.type) req.query.type = req.site.$pages;
		} else {
			if (!req.query.type) req.query.type = ['page', 'blog'];
		}

		const action = req.query.text != null ? 'page.search' : 'page.all';
		All.run(action, req, req.query).then(function (obj) {
			All.send(res, obj);
		}).catch(next);
	});
	All.app.post('/.api/page', All.auth.lock('webmaster'), function (req, res, next) {
		All.run('page.add', req, req.body).then(function (page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/.api/page', All.auth.lock('webmaster'), function (req, res, next) {
		All.run('page.save', req, req.body).then(function (page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/.api/page', All.auth.lock('webmaster'), function (req, res, next) {
		All.run('page.del', req, req.query).then(function (page) {
			res.send(page);
		}).catch(next);
	});

	All.app.get('/robots.txt', All.cache.tag('data-:site'), function (req, res, next) {
		All.run('page.robots', req).then(function (txt) {
			res.type('text/plain');
			res.send(txt);
		}).catch(next);
	});

	All.app.get('/sitemap.txt', All.cache.tag('data-:site'), function (req, res, next) {
		All.run('page.all', req, {
			robot: true,
			type: ['page', 'blog'] // TODO do not return pages that require a query
			// TODO do not return pages that do not have a properties.nositemap (nor sitemap)
		}).then(function (obj) {
			res.type('text/plain');
			All.auth.filter(req, obj);
			res.send(obj.items.map(page => req.site.href + page.data.url).join('\n'));
		}).catch(next);
	});
}

function QueryPage({ site, trx }) {
	return site.$relatedQuery('children', trx).alias('page')
		.select()
		.first()
		// eager load children (in which there are standalones)
		// and children of standalones
		.withGraphFetched(`[
		children(childrenFilter),
		children(standalonesFilter) as standalones .children(childrenFilter)
	]`).modifiers({
			childrenFilter(query) {
				return query.select().where('page.standalone', false);
			},
			standalonesFilter(query) {
				return query.select().where('page.standalone', true);
			}
		});
}

exports.get = function (req, data) {
	const { site } = req;
	const obj = {
		status: 200,
		site: site.data
	};

	const wkp = /^\/\.well-known\/(\d{3})$/.exec(data.url);
	if (wkp) obj.status = parseInt(wkp[1]);
	return QueryPage(req).whereIn('page.type', site.$pages)
		.whereJsonText("page.data:url", data.url)
		.select(
			All.href.collect(req, { url: data.url, content: true }).as('hrefs')
		).then(function (page) {
			if (!page) {
				obj.status = 404;
			} else if (All.auth.locked(req, (page.lock || {}).read)) {
				obj.status = 401;
			}
			if (obj.status != 200) {
				const statusUrl = `/.well-known/${obj.status}`;
				return QueryPage(req)
					.where('page.type', 'page')
					.whereJsonText("page.data:url", statusUrl)
					.select(
						All.href.collect(req, { url: statusUrl, content: true }).as('hrefs')
					).then(function (page) {
						if (!page) throw new HttpError[obj.status]();
						return page;
					});
			} else {
				return page;
			}
		}).then(function (page) {
			const links = {};
			Object.assign(obj, {
				item: page,
				items: (page.children || []).concat(page.standalones || []),
				meta: site.$bundles[page.type].meta,
				links: links,
				hrefs: page.hrefs
			});
			delete page.standalones;
			delete page.children;
			delete page.hrefs;

			return Promise.all([
				getParents(req, data.url),
				listPages(req, {
					drafts: true,
					parent: data.url.split('/').slice(0, -1).join('/')
				}).clearSelect().select([
					ref('block.data:url').as('url'),
					ref('block.data:redirect').as('redirect'),
					ref('block.data:title').as('title')
				])
			]).then(function (list) {
				links.up = list[0].map(redUrl);
				const siblings = list[1];
				let found;
				const position = siblings.findIndex(function (item) {
					const same = item.url == data.url;
					if (same) {
						found = true;
					} else if (!found && data.url.length > 1 && item.url.startsWith(data.url)) {
						found = item.url;
					}
					return same;
				});
				if (found && found !== true) links.found = found;
				if (position > 0) links.prev = redUrl(siblings[position - 1]);
				if (position < siblings.length - 1) links.next = redUrl(siblings[position + 1]);
				if (siblings.length > 1) {
					links.first = redUrl(siblings[0]);
					links.last = redUrl(siblings[siblings.length - 1]);
				}
				return obj;
			});
		});
};
exports.get.schema = {
	$action: 'read',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'pathname'
		}
	}
};

function redUrl(obj) {
	if (obj.redirect) {
		obj.url = obj.redirect;
	}
	delete obj.redirect;
	return obj;
}

function getParents({ site, trx }, url) {
	const urlParts = url.split('/');
	const urlParents = ['/'];
	for (let i = 1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return site.$relatedQuery('children', trx).select([
		ref('block.data:url').as('url'),
		ref('block.data:redirect').as('redirect'),
		ref('block.data:title').as('title')
	])
		.whereIn('block.type', site.$pages)
		.whereJsonText('block.data:url', 'IN', urlParents)
		.orderByRaw("length(block.data->>'url') DESC");
}

function listPages({ site, trx }, data) {
	const q = site.$relatedQuery('children', trx)
		.selectWithout('content')
		.whereIn('block.type', data.type || site.$pages)
		.where('block.standalone', true);

	if (!data.drafts) {
		q.whereNotNull(ref('block.data:url'));
		q.where(function () {
			this.whereNull(ref('block.data:nositemap'))
				.orWhereNot(ref('block.data:nositemap'), true);
		});
	}
	if (data.robot) {
		q.where(function () {
			this.whereNull(ref('block.data:noindex'))
				.orWhereNot(ref('block.data:noindex'), true);
		});
	}
	if (data.disallow) {
		q.where(ref('block.data:noindex'), true);
	}

	if (data.parent != null) {
		const regexp = data.home ? `^${data.parent}(/[^/]+)?$` : `^${data.parent}/[^/]+$`;
		if (data.home) q.orderByRaw("block.data->>'url' = ? DESC", data.parent);
		q.whereJsonText('block.data:url', '~', regexp)
			.orderBy(ref('block.data:index'));
	} else if (data.url) {
		q.whereJsonText('block.data:url', 'LIKE', `${data.url || ''}%`);
	} else {
		// just return all pages for the sitemap
	}
	if (data.limit) q.limit(data.limit);
	if (data.offset) q.offset(data.offset);
	return q.orderBy(ref('block.data:url'), 'block.updated_at DESC');
}

exports.search = function ({ site, trx }, data) {
	let drafts = '';
	if (!data.drafts) {
		drafts = `AND (page.data->'nositemap' IS NULL OR (page.data->'nositemap')::BOOLEAN IS NOT TRUE)`;
	}
	const types = data.type || site.$pages;

	const q = trx.raw(`SELECT json_build_object(
		'count', count,
		'rows', json_agg(
			json_build_object(
				'id', id,
				'type', type,
				'updated_at', updated_at,
				'data', json_build_object(
					'title', title,
					'url', url,
					'headlines', headlines,
					'rank', rank
				)
			)
		)) AS result FROM (
		SELECT
			id, type, title, url, updated_at, json_agg(DISTINCT headlines) AS headlines, sum(qrank) AS rank,
			count(*) OVER() AS count
		FROM (
			SELECT
				page.id,
				page.type,
				page.data->>'title' AS title,
				page.data->>'url' AS url,
				page.updated_at,
				(SELECT string_agg(heads.value, '<br>') FROM (SELECT DISTINCT trim(value) AS value FROM jsonb_each_text(ts_headline('unaccent', block.content, search.query)) WHERE length(trim(value)) > 0) AS heads) AS headlines,
				ts_rank(block.tsv, search.query) AS qrank
			FROM
				block AS site,
				relation AS rs,
				block,
				relation AS rp,
				block AS page,
				(SELECT websearch_to_tsquery('unaccent', ?) AS query) AS search
			WHERE
				site.type = 'site' AND site.id = ?
				AND rs.parent_id = site._id AND block._id = rs.child_id
				AND block.type NOT IN ('site', 'user', 'fetch', 'template', 'api_form', 'query_form', 'priv', 'settings', ${site.$pages.map(_ => '?').join(',')})
				AND rp.child_id = block._id AND page._id = rp.parent_id
				${drafts}
				AND page.type IN (${types.map(_ => '?').join(',')})
				AND search.query @@ block.tsv
		) AS results
		GROUP BY id, type, title, url, updated_at ORDER BY rank DESC, updated_at DESC OFFSET ? LIMIT ?
	) AS foo GROUP BY count`, [
		data.text,
		site.id,
		...site.$pages,
		...types,
		data.offset,
		data.limit
	]);
	return q.then(function (results) {
		const obj = {
			offset: data.offset,
			limit: data.limit,
			total: 0
		};
		if (results.rowCount == 0) {
			obj.items = [];
		} else {
			const result = results.rows[0].result;
			obj.items = result.rows;
			obj.total = result.count;
		}
		return obj;
	});
};

exports.search.schema = {
	title: 'Search pages',
	$action: 'read',
	required: ['text'],
	properties: {
		text: {
			title: 'Search text',
			type: 'string',
			format: 'singleline'
		},
		limit: {
			title: 'Limit',
			type: 'integer',
			minimum: 0,
			maximum: 50,
			default: 10
		},
		offset: {
			title: 'Offset',
			type: 'integer',
			minimum: 0,
			default: 0
		},
		drafts: {
			title: 'Show pages that are not in sitemap',
			type: 'boolean',
			default: false
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
			},
			nullable: true
		}
	}
};
exports.search.external = true;

exports.all = function (req, data) {
	return listPages(req, data).then(function (pages) {
		const els = {};
		const obj = {
			items: pages
		};
		if (data.home) {
			obj.item = pages.shift();
			if (obj.item && obj.item.data.url != data.parent) delete obj.item;
		} else {
			req.site.$pages.forEach(function (type) {
				const schema = req.site.$schema(type);
				els[type] = schema;
			});
			obj.item = {
				type: 'sitemap'
			};
			obj.meta = {
				elements: els
			};
		}
		return obj;
	});
};
exports.all.schema = {
	title: 'Site map',
	$action: 'read',
	properties: {
		parent: {
			title: 'Root pathname',
			type: 'string',
			format: 'pathname'
		},
		home: {
			title: 'Returns root as first item',
			type: 'boolean',
			default: false
		},
		url: {
			type: 'string',
			format: 'pathname'
		},
		limit: {
			title: 'Limit',
			type: 'integer',
			minimum: 0
		},
		offset: {
			title: 'Offset',
			type: 'integer',
			minimum: 0,
			default: 0
		},
		drafts: {
			type: 'boolean',
			default: false
		},
		robot: {
			type: 'boolean',
			default: false
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
			},
			nullable: true
		}
	}
};
exports.all.external = true;

exports.save = function (req, changes) {
	changes = Object.assign({
		// blocks removed from their standalone parent (grouped by parent)
		unrelate: {},
		// non-standalone blocks unrelated from site and deleted
		remove: [],
		// any block added and related to site
		add: [],
		// block does not change parent
		update: [],
		// block add to a new standalone parent (grouped by parent)
		relate: {}
	}, changes);

	const pages = {
		add: changes.add.filter(b => b.type == "page"),
		update: changes.update.filter(b => b.type == "page")
	};
	pages.all = pages.add.concat(pages.update);

	changes.add.forEach(function (b) {
		stripHostname(req.site, b);
	});
	changes.update.forEach(function (b) {
		stripHostname(req.site, b);
	});
	// this also effectively prevents removing a page and adding a new page
	// with the same url as the one removed
	const allUrl = {};
	const returning = {};
	return req.site.$relatedQuery('children', req.trx)
		.select('block.id', ref('block.data:url').as('url'))
		.whereIn('block.type', req.site.$pages)
		.whereNotNull(ref('block.data:url')).then(function (dbPages) {
			pages.all.forEach(function (page) {
				if (!page.data.url) {
					delete page.data.url;
				} else if (allUrl[page.data.url]) {
					throw new HttpError.BadRequest("Two pages with same url");
				} else {
					if (!page.id) throw new HttpError.BadRequest("Page without id");
					allUrl[page.data.url] = page.id;
				}
			});
			dbPages.forEach(function (dbPage) {
				const id = allUrl[dbPage.url];
				if (id != null && dbPage.id != id) {
					throw new HttpError.BadRequest("Page url already exists");
				}
			});
		}).then(function () {
			// FIXME use site.$model.hrefs to track the blocks with href when saving,
			// and check all new/changed href have matching row in href table
			return applyUnrelate(req, changes.unrelate).then(function () {
				return applyRemove(req, changes.remove, changes.recursive);
			}).then(function () {
				return applyAdd(req, changes.add);
			}).then(function (list) {
				returning.update = list || [];
				return applyUpdate(req, changes.update);
			}).then(function (list) {
				returning.update = returning.update.concat(list);
				return applyRelate(req, changes.relate);
			});
		}).then(function (parts) {
			return Promise.all(pages.update.map(function (child) {
				if (!child.data.url || child.data.url.startsWith('/.')) return;
				return All.href.save(req, {
					url: child.data.url,
					title: child.data.title
				}).catch(function (err) {
					if (err.statusCode == 404) return All.href.add(req, {
						url: child.data.url
					}).catch(function (err) {
						console.error(err);
					});
					else console.error(err);
				});
			}));
		}).then(function () {
			return Promise.all(pages.add.map(function (child) {
				if (!child.data.url || child.data.url.startsWith('/.')) return;
				// problem: added pages are not saved here
				return All.href.add(req, {
					url: child.data.url
				}).catch(function (err) {
					console.error(err);
				});
			}));
		}).then(function () {
			return returning;
		});
};
exports.save.schema = {
	$action: 'save',
	properties: {
		add: {
			type: 'array',
			items: {
				type: 'object'
			}
		},
		update: {
			type: 'array',
			items: {
				type: 'object'
			}
		},
		remove: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
			}
		},
		relate: {
			type: 'object'
		},
		unrelate: {
			type: 'object'
		}
	}
};

function stripHostname(site, block) {
	const url = block.data && block.data.url; // FIXME use site.$model.hrefs
	if (url) {
		const objUrl = URL.parse(url);
		if (objUrl.hostname == site.hostname) {
			block.data.url = objUrl.path;
		}
	}
}

function applyUnrelate({ site, trx }, obj) {
	return Promise.all(Object.keys(obj).map(function (parentId) {
		return site.$relatedQuery('children', trx).where('block.id', parentId)
			.first().throwIfNotFound().then(function (parent) {
				return parent.$relatedQuery('children', trx)
					.unrelate()
					.whereIn('block.id', obj[parentId]);
			});
	}));
}

function applyRemove({ site, trx }, list, recursive) {
	if (!list.length) return;
	const q = site.$relatedQuery('children', trx).whereIn('block.id', list);
	if (!recursive) {
		return q.whereNot('standalone', true);
	} else {
		return q.select(raw('recursive_delete(block._id, FALSE) AS count'));
	}
}

function applyAdd({ site, trx }, list) {
	if (!list.length) return;
	// this relates site to inserted children
	return site.$relatedQuery('children', trx).insert(list).returning('*').then(function (rows) {
		return rows.map(function (row) {
			return {
				id: row.id,
				updated_at: row.updated_at
			};
		});
	});
}

function applyUpdate(req, list) {
	const blocksMap = {};
	const updates = [];
	return list.reduce(function (p, block) {
		return p.then(function () {
			if (block.id in blocksMap) block.updated_at = blocksMap[block.id];
			if (req.site.$pages.includes(block.type)) {
				return updatePage(req, block, blocksMap);
			} else if (!block.updated_at) {
				throw new HttpError.BadRequest(`Block is missing 'updated_at' ${block.id}`);
			} else {
				// simpler path
				return req.site.$relatedQuery('children', req.trx)
					.where('block.id', block.id)
					.where('block.type', block.type)
					.where(raw("date_trunc('milliseconds', block.updated_at)"), block.updated_at)
					.patch(block)
					.returning('id', 'updated_at')
					.first()
					.then(function (part) {
						if (!part) {
							throw new HttpError.Conflict(`${block.type}:${block.id} last update mismatch ${block.updated_at}`);
						}
						return part;
					});
			}
		}).then(function (update) {
			updates.push(update);
		});
	}, Promise.resolve()).then(function () {
		return updates;
	});
}

function updatePage({ site, trx }, page, sideEffects) {
	if (!sideEffects) sideEffects = {};
	return site.$relatedQuery('children', trx).where('block.id', page.id)
		.whereIn('block.type', page.type ? [page.type] : site.$pages)
		.select(ref('block.data:url').as('url')).first().throwIfNotFound().then(function (dbPage) {
			const oldUrl = dbPage.url;
			const oldUrlStr = oldUrl == null ? '' : oldUrl;
			const newUrl = page.data.url;
			if (oldUrl == newUrl) return dbPage;
			const hrefs = site.$model.hrefs;
			return Promise.all(Object.keys(hrefs).map(function (type) {
				return Promise.all(hrefs[type].map(function (desc) {
					const key = 'block.data:' + desc.path;
					const field = ref(key).castText();
					const args = field._createRawArgs(All.api.Block.query());
					return site.$relatedQuery('children', trx).where('block.type', type)
						.where(function () {
							this.where(field, 'LIKE', `${oldUrlStr}/%`);
							if (oldUrl == null) this.orWhereNull(field);
							else this.orWhere(field, oldUrl);
						})
						.patch({
							[key]: raw(
								`overlay(${args[0]} placing ? from 1 for ${oldUrlStr.length})`,
								args[1],
								newUrl
							)
						})
						.skipUndefined()
						.returning('block.id', 'block.updated_at')
						.then(function (rows) {
							rows.forEach(function (row) {
								const date = row.updated_at.toISOString();
								sideEffects[row.id] = date;
								if (page.id == row.id) page.updated_at = date;
							});
						});
				}));
			})).then(function () {
				const Href = All.api.Href;
				return Href.query(trx).where('_parent_id', site._id)
					.where('type', 'link')
					.where(function () {
						this.where('url', 'LIKE', `${oldUrlStr}/%`);
						if (oldUrl == null) this.orWhereNull('url');
						else this.orWhere('url', oldUrl);
					}).delete();
			}).then(function () {
				return dbPage;
			});
		}).then(function (dbPage) {
			return site.$relatedQuery('children', trx).where('block.id', page.id)
				.where(raw("date_trunc('milliseconds', block.updated_at)"), page.updated_at)
				.patch(page)
				.returning('block.id', 'block.updated_at')
				.first()
				.then(function (part) {
					if (!part) {
						throw new HttpError.Conflict(`${page.type}:${page.id} last update mismatch ${page.updated_at}`);
					}
					return part;
				});
		}).catch(function (err) {
			console.error("cannot updatePage", err);
			throw err;
		});
}

function applyRelate({ site, trx }, obj) {
	return Promise.all(Object.keys(obj).map(function (parentId) {
		return site.$relatedQuery('children', trx).where('block.id', parentId)
			.first().throwIfNotFound().then(function (parent) {
				return site.$relatedQuery('children', trx)
					.whereIn('block.id', obj[parentId])
					.select('block.id', 'block._id', 'block.standalone', 'rel.child_id')
					.leftOuterJoin('relation as rel', function () {
						this.on('rel.parent_id', '=', parent._id)
							.andOn('rel.child_id', '=', 'block._id');
					}).then(function (ids) {
						// do not relate again
						const unrelateds = ids.filter(item => !item.child_id);
						if (ids.length != obj[parentId].length) {
							const missing = obj[parentId].reduce(function (list, id) {
								if (!ids.some(function (item) {
									return item.id === id;
								})) list.push(id);
								return list;
							}, []);
							throw HttpError(404, "Unknown blocks", { blocks: missing });
						}
						return parent.$relatedQuery('children', trx).relate(unrelateds);
					});
			});
	}));
}

exports.add = function (req, data) {
	return req.site.$beforeInsert.call(data).then(function () {
		return exports.save(req, {
			add: [data]
		});
	});
};
exports.add.schema = {
	$action: 'add',
	properties: {
		type: {
			'enum': ["page", "mail"],
			default: "page"
		},
		data: {
			type: 'object'
		}
	}
};

exports.del = function ({ site, trx }, data) {
	return All.run('block.get', { site, trx }, data).then(function (page) {
		return site.$relatedQuery('children', trx)
			.select('block.id', 'block.type', 'block.content', ref('parents.id').as('parentId'), ref('parents.data:url').as('parentUrl'))
			.where(ref('block.data:url').castText(), page.data.url)
			.joinRelated('parents')
			.whereNot('parents.type', 'site')
			.whereNot('parents.id', page.id)
			.then(function (links) {
				if (links.length > 0) {
					throw new HttpError.Conflict(Text`
					There are ${links.length} referrers to this page:
					${JSON.stringify(links, null, ' ')}
				`);
				}
				return All.api.Href.query(trx).where('url', page.data.url).del();
			})
			.then(function () {
				return All.run('block.del', { site, trx }, {
					id: page.id,
					type: page.type
				});
			});
	});
};
exports.del.schema = {
	$action: 'del',
	required: ['id'],
	properties: {
		id: {
			title: 'id',
			type: 'string',
			format: 'id'
		}
	}
};

exports.robots = function (req) {
	const lines = [];
	let p;
	if (req.site.data.env == "production") {
		lines.push(`Sitemap: ${req.site.href}/sitemap.txt`);
		lines.push('User-agent: *');
		p = listPages(req, { disallow: true, type: ['page', 'blog'] }).then(function (pages) {
			pages.forEach(function (page) {
				lines.push(`Disallow: ${page.data.url}`);
			});
		});
	} else {
		p = Promise.resolve();
		lines.push('User-agent: *');
		lines.push("Disallow: /");
	}
	return p.then(function () {
		return lines.join('\n');
	});
};
exports.robots.schema = {
	$action: 'read'
};
