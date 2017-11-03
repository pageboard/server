var ref = require('objection').ref;
var raw = require('objection').raw;

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
		exports.find(req.query).then(function(pages) {
			res.send(pages);
		}).catch(next);
	});
	All.app.get('/.api/elements.js', All.query, function(req, res, next) {
		All.api.DomainBlock(req.query.domain).then(function(DomainBlock) {
			res.type('text/javascript');
			res.send('Pageboard.elements = ' + DomainBlock.source);
		}).catch(next);
	});
	All.app.post('/.api/page', All.body, function(req, res, next) {
		exports.add(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/.api/page', All.body, function(req, res, next) {
		exports.save(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/.api/page', All.query, function(req, res, next) {
		exports.del(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
}

function QueryPage(Block) {
	return Block.query()
	.select(Block.jsonColumns)
	.whereDomain(Block.domain)
	.first()
	.eager(`[
		children(childrenFilter),
		children(standalonesFilter) as standalones .children
	]`, { // i don't understand the above relation expression "as standalones .children"
		childrenFilter: function(query) {
			return query.select(Block.jsonColumns).where('block.standalone', false);
		},
		standalonesFilter: function(query) {
			return query.select(Block.jsonColumns).where('block.standalone', true);
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
				return QueryPage(Block).where('block.type', 'notfound');
			} else {
				return page;
			}
		}).then(function(page) {
			page.children = page.children.concat(page.standalones);
			delete page.standalones;
			var pageUrl = page.data.url;
			return Promise.all([
				getParents(Block, pageUrl),
				getDirectory(Block, pageUrl == "/" ? pageUrl : pageUrl + "/"),
				getDirectory(Block, pageUrl)
			]).then(function(list) {
				page.links = {};
				page.links.up = list[0];
				page.links.down = list[1];
				var siblings = list[2];
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
	.whereJsonText('block.data:url', 'IN', urlParents);
}

function getDirectory(Block, url) {
	// return all url which have this url as parent
	var parentUrl = url.split('/').slice(0, -1).join('/') || '/';
	return Block.query().whereDomain(Block.domain).select([
		ref('block.data:url').as('url'),
		ref('block.data:title').as('title')
	])
	.where('block.type', 'page')
	.whereJsonText('block.data:url', '~', `^${parentUrl}/[^/]+$`);
}

exports.find = function(data) {
	var Block = All.api.Block;
	return Block.query()
	.select(Block.jsonColumns)
	.omit(['content'])
	.whereDomain(data.domain)
	.where('block.type', 'page')
	.whereJsonText('block.data:url', 'LIKE', `${data.url || ''}%`)
	.orderBy(ref('block.data:url'));
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
			return block.type == "page"; // might be obj.data.url but not sure
		});
		return All.api.transaction(DomainBlock, function(Block) {
			return Block.query().whereJsonText('block.data:domain', changes.domain)
			.first().then(function(inst) {
				if (!inst) throw new HttpError.NotFound("Site not found");
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
				var host;
				try {
					host = All.domains.host(site.data.domain);
				} catch(ex) {
					console.warn("Unknown host for domain", site.data.domain);
					console.info("This can happen when running from cli");
					return;
				}
				return All.href.save({
					url: host + child.data.url,
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
		return site.$relatedQuery('children').where('block.id', parentId).first().then(function(parent) {
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
			.where('block.id', block.id).patch(block).then(function(count) {
				if (count == 0) throw new Error(`Block not found for update ${block.id}`);
			});
		}
	}));
}

function updatePage(site, page) {
	return site.$relatedQuery('children').where('block.id', page.id).where('block.type', 'page')
	.select(ref('block.data:url').as('url')).first().then(function(dbPage) {
		var oldUrl = dbPage.url;
		var newUrl = page.data.url;
		if (oldUrl == newUrl) return dbPage;
		return site.$relatedQuery('children').whereNot('block.type', 'page')
		.where(ref('block.data:url'), 'LIKE', `${oldUrl}%`)
		.update({
			'block.data:url': raw(`overlay(block.data->>'url' placing ? from 1 to ${oldUrl.length})`, newUrl)
		}).then(function() { return dbPage; });
	}).then(function(dbPage) {
		return site.$relatedQuery('children').where('block.id', page.id).where('block.type', 'page').patch(page);
	}).catch(function(err) {
		console.error("cannot updatePage", err);
		throw err;
	});
}

function applyRelate(site, obj) {
	return Promise.all(Object.keys(obj).map(function(parentId) {
		return site.$relatedQuery('children').where('block.id', parentId)
		.select('block._id').first().then(function(parent) {
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
					standalone: true,
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

