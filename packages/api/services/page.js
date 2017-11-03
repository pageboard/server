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
	]`, {
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
			var urlParts = data.url.split('/');
			var urlParents = ['/'];
			for (var i=1; i < urlParts.length - 1; i++) {
				urlParents.push(urlParts.slice(0, i + 1).join('/'));
			}
			return DomainBlock.query().select([
				All.api.ref('block.data:url').as('url'),
				All.api.ref('block.data:title').as('title')
			])
			.where('block.type', 'page')
			.whereJsonText('block.data:url', 'IN', urlParents).then(function(parents) {
				page.ancestors = parents;
				return page;
			});
		});
	});
};

exports.find = function(data) {
	var Block = All.api.Block;
	return Block.query()
	.select(Block.jsonColumns)
	.omit(['content'])
	.whereDomain(data.domain)
	.where('block.type', 'page')
	.whereJsonText('block.data:url', 'LIKE', `${data.url || ''}%`)
	.orderBy(All.api.ref('block.data:url'));
};

exports.save = function(changes) {
	// changes.remove, add, update are lists of blocks
	// changes.page is the page id
	// normal blocks belongs to the page
	// standalone blocks follow these rules:
	// - if it is added, it is added to the site, and to the current page as well
	//   (it is not possible to add a standalone block without adding it to the current page)
	// - if it is updated, it is already added to the current page
	//   (a block cannot become standalone, only added blocks can be standalone, so when
	//    the client wants to change a block to become standalone, it is actually a new copy).
	// - if it is removed, it is removed from the current page. The standalone block
	//   will only be removed later by a garbage collector if no longer used.

	if (!changes.add) changes.add = [];
	if (!changes.update) changes.update = [];
	if (!changes.remove) changes.remove = [];

	return All.api.DomainBlock(changes.domain).then(function(DomainBlock) {
		var site, page;
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
				return site.$relatedQuery('children').where('block.type', 'page').then(function(dbPages) {
					var allUrl = {};
					pages.forEach(function(page) {
						if (allUrl[page.data.url]) throw new HttpError.BadRequest("Two pages with same url");
						if (!page.id) throw new HttpError.BadRequest("Page without id");
						allUrl[page.data.url] = page.id;
					});
					dbPages.forEach(function(dbPage) {
						var id = allUrl[dbPage.data.url];
						if (id && dbPage.id != id) throw new HttpError.BadRequest("Page url already exists");
					});
				});
			}).then(function() {
				if (changes.page) return site.$relatedQuery('children').where('block.id', changes.page)
				.first().then(function(inst) {
					if (!inst) throw new HttpError.NotFound("Page not found");
					page = inst;
				});
			}).then(function() {
				return removeChanges(site, page, changes.remove);
			}).then(function() {
				return addChanges(site, page, changes.add);
			}).then(function() {
				return updateChanges(site, page, changes.update);
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

function updateChanges(site, page, updates) {
	// here we just try to patch and let the db decide what was actually possible
	return Promise.all(updates.map(function(child) {
		delete child.orphan;
		return site
		.$relatedQuery('children')
		.patch(child)
		.where({
			id: child.id
		}).then(function() {
			if (page) return page
			.$relatedQuery('children')
			.patch(child)
			.where({
				id: child.id
			});
		});
	}));
}

function addChanges(site, page, adds) {
	// insert page children then relate standalone blocks to site
	// insert site children (orphans)
	var childrenOfPage = [];
	var childrenOfSite = [];
	adds.forEach(function(block) {
		if (block.orphan) childrenOfSite.push(block);
		else childrenOfPage.push(block);
		delete block.orphan;
	});
	return Promise.all([
		page ? page.$relatedQuery('children').insert(childrenOfPage).then(function(rows) {
			var alones = rows.filter(row => row.standalone).map(row => row._id);
			if (alones.length == 0) return;
			return site.$relatedQuery('children').relate(alones);
		}) : Promise.resolve(),
		site.$relatedQuery('children').insert(childrenOfSite)
	]);
}

function removeChanges(site, page, removes) {
	var ids = removes.map(obj => obj.id);
	if (page) return page.$relatedQuery('children')
	.unrelate()
	.whereIn('id', ids)
	.then(function() {
		// now remove all blocks that are not standalone blocks, trusting db only
		return page
		.$relatedQuery('children')
		.delete()
		.whereIn('id', ids)
		.where('standalone', false);
	});
	// removal of orphans or of standalones that have become orphans is done
	// by some garbage collector
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
					orphan: true,
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

