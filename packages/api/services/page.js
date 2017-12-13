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
	All.app.get('/.api/page', All.query, function(req, res, next) {
		exports.get(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.get('/.api/pages', All.query, function(req, res, next) {
		exports.list(req.query).then(function(pages) {
			res.send(pages);
		}).catch(next);
	});
	All.app.post('/.api/page', All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.add(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/.api/page', All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.save(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/.api/page', All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.del(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
}

function QueryPage(Block) {
	return Block.query()
	.select(Block.tableColumns)
	.whereDomain(Block.domain)
	.first()
	// eager load children (in which there are standalones)
	// and children of standalones
	.eager(`[
		children(childrenFilter),
		children(standalonesFilter) as standalones .children(childrenFilter)
	]`, {
		childrenFilter: function(query) {
			return query.select(Block.tableColumns).where('block.standalone', false);
		},
		standalonesFilter: function(query) {
			return query.select(Block.tableColumns).where('block.standalone', true);
		}
	});
}

exports.get = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	if (!data.url) throw new HttpError.BadRequest("Missing url");

	return All.api.DomainBlock(data.domain).then(function(Block) {
		return QueryPage(Block).where('block.type', 'page')
		.whereJsonText("block.data:url", data.url)
		.then(function(page) {
			if (!page) {
				return QueryPage(Block).where('block.type', 'notfound').throwIfNotFound();
			} else {
				return page;
			}
		}).then(function(page) {
			page.children = page.children.concat(page.standalones);
			delete page.standalones;
			var pageUrl = page.data.url || data.url;
			return Promise.all([
				getParents(Block, pageUrl),
				listPages(Block, {
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
	});
};

function getParents(Block, url) {
	var urlParts = url.split('/');
	var urlParents = ['/'];
	for (var i=1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return Block.query().whereDomain(Block.domain).select([
		ref('block.data:url').as('url'),
		ref('block.data:title').as('title')
	])
	.where('block.type', 'page')
	.whereJsonText('block.data:url', 'IN', urlParents)
	.orderByRaw("length(block.data->>'url') DESC");
}

function listPages(Block, data) {
	var q = Block.query()
	.select(Block.tableColumns)
	.omit(['content'])
	.whereDomain(data.domain || Block.domain)
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

function searchPages(Block, data) {
	if (!data.text) return Promise.resolve({rows:[],pages:0,page:0});
	var text = data.text.split(' ')
	.filter(x => !!x)
	.map(x => x + ':*')
	.join(' <-> ');

	/* // i tried using knex/objection but i failed miserably
	var q = Block.query()
	.select([
		'title',
		'url',
		'updated_at',
		raw("sum(rank) AS srank"),
		raw("jsonb_agg(content) AS contents")
	])
	.groupBy('title', 'url', 'updated_at')
	.orderBy('srank', 'desc')
	.orderBy('updated_at', 'desc');
	if (data.paginate) q.offset(Math.max(parseInt(data.paginate) - 1 || 0, 0) * 10);
	q.limit(10);
	q.from(function(builder) {
		builder.select([
			ref('page.data:title').castText().as('title'),
			ref('page.data:url').castText().as('url'),
			'page.updated_at',
			'block.content',
			raw("ts_rank(block.tsv, query) AS rank")
		])
		.join('relation', 'block._id', 'relation.child_id')
		.join('block AS page', 'relation._parent_id', 'block._id')
		.join('relation', 'relation._parent_id', 'block._id')
		.joinRelation("[parents as page,parents as site]")
		.where('site.type', 'site')
		.where(ref('site.data:domain').castText(), data.domain)
		.whereNotIn('block.type', ['site', 'user'])
		.where('page.type', 'page')
		.whereRaw('query @@ block.tsv')
		.from(raw([
			raw("to_tsquery('unaccent', ?) AS query", [text]),
			'block'
		])).as('sub');
	});
	*/

	var limit = 10;
	var page = !data.page ? 1 : parseInt(data.page);
	if (isNaN(page) || page <= 0) throw new HttpError.BadRequest("page must be a positive integer");

	var q = Block.raw(`SELECT json_build_object(
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
			title, url, updated_at, json_agg(headlines) AS headlines, sum(qrank) AS rank,
			count(*) OVER() AS count
		FROM (
			SELECT
				page.data->>'title' AS title,
				page.data->>'url' AS url,
				page.updated_at,
				(SELECT array_agg(value) FROM jsonb_each_text(ts_headline('unaccent', block.content, search.query))) AS headlines,
				ts_rank(block.tsv, search.query) AS qrank
			FROM
				block AS site,
				relation AS rs,
				block,
				relation AS rp,
				block AS page,
				(SELECT to_tsquery('unaccent', ?) AS query) AS search
			WHERE
				site.type = 'site' AND site.data->>'domain' = ?
				AND rs.parent_id = site._id AND block._id = rs.child_id
				AND block.type NOT IN ('site', 'user', 'page')
				AND rp.child_id = block._id AND page._id = rp.parent_id
				AND page.type = 'page'
				AND search.query @@ block.tsv
		) AS results
		GROUP BY title, url, updated_at ORDER BY rank DESC OFFSET ? LIMIT ?
	) AS foo GROUP BY count`, [
		text,
		data.domain,
		(page - 1) * limit,
		limit
	]);
	return q.then(function(results) {
		if (results.rowCount == 0) return {rows:[], pages: 0, page: 0};
		var result = results.rows[0].result;
		result.limit = limit;
		result.pages = Math.ceil(result.count / limit);
		result.page = page;
		delete result.count;
		return result;
	});
}

exports.search = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return searchPages(All.api.Block, data);
};

exports.list = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return listPages(All.api.Block, data);
};

exports.save = function(changes) {
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

	return All.api.DomainBlock(changes.domain).then(function(DomainBlock) {
		var site;
		var pages = changes.add.concat(changes.update).filter(function(block) {
			var url = block.data && block.data.url;
			if (url) {
				var objUrl = URL.parse(url);
				if (objUrl.hostname == changes.domain) {
					block.data.url = objUrl.path;
				}
			}
			return block.type == "page"; // might be obj.data.url but not sure
		});
		return All.api.transaction(DomainBlock, function(Block) {
			return Block.query().whereJsonText('block.data:domain', changes.domain)
			.first().throwIfNotFound().then(function(inst) {
				site = inst;
			}).then(function() {
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
				return All.href.save({
					url: child.data.url,
					domain: site.data.domain,
					title: child.data.title
				}).catch(function(err) {
					console.error(err);
				});
			}));
		});
	});
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
		}).skipUndefined().then(function() { return dbPage; });
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

exports.add = function(data) {
	var emptyPage = {};
	return All.api.DomainBlock(data.domain).then(function(DomainBlock) {
		return DomainBlock.prototype.$beforeInsert.call(emptyPage).then(function() {
			return exports.save({
				domain: data.domain,
				add: [{
					id: emptyPage.id,
					type: 'page',
					data: data.data
				}]
			});
		});
	});
};

exports.del = function(data) {
	throw new HttpError.NotImplemented("TODO use save to delete page blocks");
};

