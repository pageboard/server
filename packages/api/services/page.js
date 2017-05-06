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
	var ref = All.objection.ref;
	var q = Block.query().where('block.type', 'page');
	var site = data.site;
	if (site) delete data.site;
	if (data.id) {
		q.where('block.id', data.id);
	} else {
		if (!site) throw new HttpError.BadRequest("Missing site");
		if (!data.url) throw new HttpError.BadRequest("Missing url");
		q.where(ref("block.data:url").castText(), data.url)
	}
	return q.joinRelation('parents')
		.where('parents.type', 'site')
		.where(ref('parents.data:url').castText(), site);
}

exports.get = function(data) {
	return QueryPage(data).select(All.Block.jsonColumns.map(col => `block.${col}`))
	.eager('children.^').first().then(function(page) {
		if (!page) throw new HttpError.NotFound("No page found");
		return page;
	});
};

exports.add = function(data) {
	var ref = All.objection.ref;
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	data = Object.assign({
		type: 'page'
	}, data);
	return All.Block.query().select('_id')
		.where('type', 'site')
		.where(ref('data:url').castText(), data.site)
	.first().then(function(site) {
		data.parents = [{
			'#dbRef': site._id
		}];
		delete data.site;
		return All.Block.query().insertGraph(data);
	});
};

exports.save = function(changes) {
	// changes.remove, add, update are lists of blocks
	// changes.id is the page id so we know how to parent all blocks
	return All.objection.transaction(All.Block, function(Block) {
		return QueryPage(changes, Block).select('block.id', 'block._id').first().then(function(page) {
			return removeChanges(page, changes.remove);
		}).then(function(page) {
			return addChanges(page, changes.add);
		}).then(function(page) {
			return updateChanges(page, changes.update);
		});
	});
};

function updateChanges(page, updates) {
	return Promise.all(updates.map(function(child) {
		if (child.id == page.id) {
			return page.$query().patch(child);
		} else {
			return page.$relatedQuery('children').patch(child).where('id', child.id);
		}
	}));
}

function addChanges(page, adds) {
	return page.$relatedQuery('children').insert(adds).then(function(rows) {
		return page.$relatedQuery('children').relate(rows.map(row => row._id));
	}).then(x => page);
}

function removeChanges(page, removes) {
	var ids = removes.map(obj => obj.id);
	return page.$relatedQuery('children')
	.unrelate().whereIn('id', ids).then(function() {
		// now remove all blocks that are not shared blocks
		return page.$relatedQuery('children').delete()
		.whereIn('id', ids).where('standalone', false);
	}).then(x => page);
}

exports.del = function(data) {
	return QueryPage(data).del();
};

