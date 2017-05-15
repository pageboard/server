exports = module.exports = function(opt) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.get('/api/page', All.query, function(req, res, next) {
		exports.get(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.post('/api/page', All.body, function(req, res, next) {
		exports.add(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/api/page', All.body, function(req, res, next) {
		exports.save(req.body).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/api/page', All.query, function(req, res, next) {
		exports.del(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
}

function QueryPage(data, Block) {
	if (!Block) Block = All.Block;
	var q = Block.query().where('block.type', 'page');
	if (data.id) {
		q.where('block.id', data.id);
	} else {
		if (!data.site) throw new HttpError.BadRequest("Missing site");
		if (!data.url) throw new HttpError.BadRequest("Missing url");
		q.whereJsonText("block.data:url", data.url);
	}
	return q.whereSite(data.site);
}

exports.get = function(data) {
	var blockCols = All.Block.jsonColumns.map(col => `block.${col}`);
	return QueryPage(data).select(blockCols)
	.eager('children.^').first().then(function(page) {
		if (!page) {
			return All.Block.query().select(blockCols).first()
				.whereSite(data.site).where('block.type', 'notfound')
				.eager('children.^').first();
		} else {
			return page;
		}
	});
};

exports.save = function(changes) {
	// changes.remove, add, update are lists of blocks
	// changes.id is the page id so we know how to parent all blocks
	// TODO if page is used to list pages, we have to check that affected pages url
	// + the changes do not result in multiple identical url
	var site = changes.site;
	return All.objection.transaction(All.Block, function(Block) {
		return Block.query().whereSite(site).where('block.id', changes.id)
		.whereIn('block.type', ['page', 'notfound'])
		.select('block.id', 'block._id', 'block.data').first().then(function(page) {
			if (!page) throw new HttpError.NotFound("Page not found");
			return removeChanges(site, page, changes.remove);
		}).then(function(page) {
			return addChanges(site, page, changes.add);
		}).then(function(page) {
			return updateChanges(site, page, changes.update);
		});
	});
};

function updateChanges(site, page, updates) {
	return Promise.all(updates.map(function(child) {
		if (child.id == page.id) {
			// really ?
			var p = Promise.resolve();
			if (child.data.url != page.data.url) {
				// make sure child.data.url is not already used in db
				p = p.then(function() {
					return QueryPage({
						site: site,
						url: child.data.url
					}).count().then(function(count) {
						if (count > 0) throw new HTTPError.BadRequest("url already used");
					});
				});
			}
			return p.then(function() {
				return page.$query().patch(child);
			});
		} else {
			return page.$relatedQuery('children').patch(child).where('id', child.id);
		}
	}));
}

function addChanges(site, page, adds) {
	return page.$relatedQuery('children').insert(adds).then(function(rows) {
		return page.$relatedQuery('children').relate(rows.map(row => row._id));
	}).then(x => page);
}

function removeChanges(site, page, removes) {
	var ids = removes.map(obj => obj.id);
	return page.$relatedQuery('children')
	.unrelate().whereIn('id', ids).then(function() {
		// now remove all blocks that are not shared blocks
		return page.$relatedQuery('children')
		.delete().whereIn('id', ids).where('standalone', false);
	}).then(x => page);
}

exports.add = function(data) {
	throw new HTTPError.NotImplemented("TODO use save to add page blocks");
};

exports.del = function(data) {
	throw new HTTPError.NotImplemented("TODO use save to delete page blocks");
};

