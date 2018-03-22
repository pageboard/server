var ref = require('objection').ref;
var raw = require('objection').raw;
var URL = require('url');

exports = module.exports = function(opt) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.get('/.api/page', function(req, res, next) {
		All.run('page.get', req.site, req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.get('/.api/pages', function(req, res, next) {
		All.run('page.list', req.site, req.query).then(function(pages) {
			res.send(pages);
		}).catch(next);
	});
	All.app.post('/.api/page', All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('page.add', req.site, req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/.api/page', All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('page.save', req.site, req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/.api/page', All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('page.del', req.site, req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});

	All.app.get('/robots.txt', All.cache.tag('api'), function(req, res, next) {
		All.run('page.robots', req.site).then(function(txt) {
			res.type('text/plain');
			res.send(txt);
		});
	});

	All.app.get('/.api/sitemap.txt', function(req, res, next) {
		All.run('page.list', req.site).then(function(pages) {
			res.type('text/plain');
			res.send(pages.map(page => req.site.href + page.data.url).join('\n'));
		});
	});
}

function QueryPage(site) {
	var cols = site.Block.tableColumns;
	return site.Block.query()
	.select(cols)
	.whereSite(site.id)
	.first()
	// eager load children (in which there are standalones)
	// and children of standalones
	.eager(`[
		children(childrenFilter),
		children(standalonesFilter) as standalones .children(childrenFilter)
	]`, {
		childrenFilter: function(query) {
			return query.select(cols).where('block.standalone', false);
		},
		standalonesFilter: function(query) {
			return query.select(cols).where('block.standalone', true);
		}
	});
}

exports.get = function(site, data) {
	var Block = site.Block;
	return QueryPage(site).where('block.type', 'page')
	.whereJsonText("block.data:url", data.url)
	.then(function(page) {
		if (!page) {
			return QueryPage(site).where('block.type', 'notfound').throwIfNotFound();
		} else {
			return page;
		}
	}).then(function(page) {
		page.site = site.data;
		page.children = page.children.concat(page.standalones);
		delete page.standalones;
		var pageUrl = page.data.url || data.url;
		return Promise.all([
			getParents(site, pageUrl),
			listPages(site, {
				parent: pageUrl.split('/').slice(0, -1).join('/') || '/'
			}).select([
				ref('block.data:url').as('url'),
				ref('block.data:title').as('title')
			]).omit(Block.columns)
		]).then(function(list) {
			page.links = {};
			page.links.up = list[0];
			var siblings = list[1];
			var position = siblings.findIndex(function(item) {
				return item.url == pageUrl;
			});
			if (position > 0) page.links.prev = siblings[position - 1];
			if (position < siblings.length - 1) page.links.next = siblings[position + 1];
			if (siblings.length > 1) {
				page.links.first = siblings[0];
				page.links.last = siblings[siblings.length - 1];
			}
			return page;
		});
	});
};
exports.get.schema = {
	required: ['url'],
	properties: {
		url: {
			type: 'string'
		}
	}
};

function getParents(site, url) {
	var urlParts = url.split('/');
	var urlParents = ['/'];
	for (var i=1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return site.Block.query().whereSite(site.id).select([
		ref('block.data:url').as('url'),
		ref('block.data:title').as('title')
	])
	.where('block.type', 'page')
	.whereJsonText('block.data:url', 'IN', urlParents)
	.orderByRaw("length(block.data->>'url') DESC");
}

function listPages(site, data) {
	var q = site.Block.query()
	.select(site.Block.tableColumns)
	.omit(['content'])
	.whereSite(site.id)
	.where('block.type', 'page');
	if (data.parent) {
		q.whereJsonText('block.data:url', '~', `^${data.parent}/[^/]+$`)
		.orderBy(ref('block.data:index'));
	} else if (data.url) {
		q.whereJsonText('block.data:url', 'LIKE', `${data.url || ''}%`);
	} else {
		// just return all pages for the sitemap
	}
	return q.orderBy(ref('block.data:url'));
}

exports.search = function(site, data) {
	var text = data.text.split(/\W+/)
	.filter(x => !!x)
	.map(x => x + ':*')
	.join(' <-> ');

	var q = All.api.Block.raw(`SELECT json_build_object(
		'count', count,
		'rows', json_agg(
			json_build_object(
				'title', title,
				'url', url,
				'updated_at', updated_at,
				'headlines', headlines,
				'rank', rank
			)
		)) AS result FROM (
		SELECT
			title, url, updated_at, json_agg(DISTINCT headlines) AS headlines, sum(qrank) AS rank,
			count(*) OVER() AS count
		FROM (
			SELECT
				page.data->>'title' AS title,
				page.data->>'url' AS url,
				page.updated_at,
				(SELECT DISTINCT trim(value) FROM jsonb_each_text(ts_headline('unaccent', block.content, search.query)) WHERE length(trim(value)) > 0) AS headlines,
				ts_rank(block.tsv, search.query) AS qrank
			FROM
				block AS site,
				relation AS rs,
				block,
				relation AS rp,
				block AS page,
				(SELECT to_tsquery('unaccent', ?) AS query) AS search
			WHERE
				site.type = 'site' AND site.id = ?
				AND rs.parent_id = site._id AND block._id = rs.child_id
				AND block.type NOT IN ('site', 'user', 'page')
				AND rp.child_id = block._id AND page._id = rp.parent_id
				AND page.type = 'page'
				AND search.query @@ block.tsv
		) AS results
		GROUP BY title, url, updated_at ORDER BY rank DESC OFFSET ? LIMIT ?
	) AS foo GROUP BY count`, [
		text,
		site.id,
		data.offset,
		data.limit
	]);
	return q.then(function(results) {
		var obj = {
			offset: data.offset,
			limit: data.limit,
			total: 0
		};
		if (results.rowCount == 0) {
			obj.data = [];
		} else {
			var result = results.rows[0].result;
			obj.data = result.rows;
			obj.total = result.count;
		}
		obj.schemas = {
			page: site.Block.schemaByType('page')
		};
		return obj;
	});
};

exports.search.schema = {
	required: ['text'],
	properties: {
		text: {
			type: 'string'
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
		},
		additionalProperties: false
	}
};

exports.list = function(site, data) {
	return listPages(site, data);
};
exports.list.schema = {
	properties: {
		parent: {
			type: 'string'
		},
		url: {
			type: 'string'
		}
	}
};

exports.save = function(site, changes) {
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

	var pages = changes.add.concat(changes.update).filter(function(block) {
		var url = block.data && block.data.url;
		if (url) {
			var objUrl = URL.parse(url);
			if (objUrl.hostname == site.data.domain) {
				block.data.url = objUrl.path;
			}
		}
		return block.type == "page"; // might be obj.data.url but not sure
	});
	return All.api.transaction(site.Block, function(Block) {
		// this also effectively prevents removing a page and adding a new page
		// with the same url as the one removed
		var allUrl = {};
		return site.$relatedQuery('children')
		.select('block.id', ref('block.data:url').as('url'))
		.where('block.type', 'page').then(function(dbPages) {
			pages.forEach(function(page) {
				if (allUrl[page.data.url]) throw new HttpError.BadRequest("Two pages with same url");
				if (!page.id) throw new HttpError.BadRequest("Page without id");
				allUrl[page.data.url] = page.id;
			});
			dbPages.forEach(function(dbPage) {
				var id = allUrl[dbPage.url];
				if (id != null && dbPage.id != id) {
					throw new HttpError.BadRequest("Page url already exists");
				}
			});
		}).then(function() {
			return applyUnrelate(site, changes.unrelate).then(function() {
				return applyRemove(site, changes.remove);
			}).then(function() {
				return applyAdd(site, changes.add);
			}).then(function() {
				return applyUpdate(site, changes.update);
			}).then(function() {
				return applyRelate(site, changes.relate);
			});
		});
	}).then(function() {
		// do not return that promise - reply now
		Promise.all(pages.map(function(child) {
			return All.href.save(site, {
				url: child.data.url,
				title: child.data.title
			}).catch(function(err) {
				console.error(err);
			});
		}));
	});
};
exports.save.schema = {
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
				type: 'string'
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

function applyUnrelate(site, obj) {
	return Promise.all(Object.keys(obj).map(function(parentId) {
		return site.$relatedQuery('children').where('block.id', parentId)
		.first().throwIfNotFound().then(function(parent) {
			return parent.$relatedQuery('children').unrelate().whereIn('block.id', obj[parentId]);
		});
	}));
}

function applyRemove(site, list) {
	if (!list.length) return;
	return site.$relatedQuery('children').delete()
	.whereIn('block.id', list).whereNot('standalone', true);
}

function applyAdd(site, list) {
	if (!list.length) return;
	// this relates site to inserted children
	return site.$relatedQuery('children').insert(list);
}

function applyUpdate(site, list) {
	return Promise.all(list.map(function(block) {
		if (block.type == "page") {
			return updatePage(site, block);
		} else {
			// simpler path
			return site.$relatedQuery('children')
			.where('block.id', block.id).patch(block).skipUndefined().then(function(count) {
				if (count == 0) throw new Error(`Block not found for update ${block.id}`);
			});
		}
	}));
}

function updatePage(site, page) {
	return site.$relatedQuery('children').where('block.id', page.id).where('block.type', 'page')
	.select(ref('block.data:url').as('url')).first().throwIfNotFound().then(function(dbPage) {
		var oldUrl = dbPage.url;
		var newUrl = page.data.url;
		if (oldUrl == newUrl) return dbPage;
		return site.$relatedQuery('children').whereNot('block.type', 'page')
		.where(function() {
			this.where(ref('block.data:url').castText(), 'LIKE', `${oldUrl}/%`)
			.orWhere(ref('block.data:url').castText(), oldUrl);
		})
		.patch({
			'block.data:url': raw(`overlay(block.data->>'url' placing ? from 1 for ${oldUrl.length})`, newUrl)
		}).skipUndefined().then(function() {
			var Href = All.api.Href;
			return Href.query().where('_parent_id', site._id)
			.where('type', 'link')
			.where(function() {
				this.where('url', 'LIKE', `${oldUrl}/%`)
				.orWhere('url', oldUrl);
			}).delete();
		}).then(function() {
			return dbPage;
		});
	}).then(function(dbPage) {
		return site.$relatedQuery('children').where('block.id', page.id).where('block.type', 'page').patch(page).skipUndefined();
	}).catch(function(err) {
		console.error("cannot updatePage", err);
		throw err;
	});
}

function applyRelate(site, obj) {
	return Promise.all(Object.keys(obj).map(function(parentId) {
		return site.$relatedQuery('children').where('block.id', parentId)
		.select('block._id').first().throwIfNotFound().then(function(parent) {
			return site.$relatedQuery('children').select('block._id')
			.whereIn('block.id', obj[parentId]).then(function(ids) {
				return parent.$relatedQuery('children').relate(ids);
			});
		});
	}));
}

exports.add = function(site, data) {
	var emptyPage = {};
	return site.Block.prototype.$beforeInsert.call(emptyPage).then(function() {
		return exports.save(site, {
			add: [{
				id: emptyPage.id,
				type: 'page',
				data: data.data
			}]
		});
	});
};
exports.add.schema = {
	properties: {
		data: {
			type: 'object'
		}
	},
	additionalProperties: false
};

exports.del = function(site, data) {
	// TODO deleting a page should be done in TWO steps
	// 1) data.url = null -> the page becomes only accessible through admin
	// 2) actual deletion
	// consequences:
	// - if there are links starting or equal to that page url, it's not possible
	// to delete that url
	// - sitemap needs a specific zone that displays pages that have no url
	// - deleting a page from that zone actually deletes the page
	// - moving a page to that zone removes the url of the page (when saving,
	// and when possible)
	throw new HttpError.NotImplemented("TODO use save to delete page blocks");
};

exports.robots = function(site) {
	var lines = ["User-agent: *"];
	if (site.data.production) {
		lines.push(`Sitemap: ${site.href}/.api/sitemap.txt`);
	} else {
		lines.push("Disallow: /");
	}
	return Promise.resolve(lines.join('\n'));
};

