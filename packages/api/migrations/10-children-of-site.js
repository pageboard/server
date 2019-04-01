exports.up = function(knex) {
	// get sites
	var numFixes = 0;
	return knex.schema.raw("UPDATE block SET standalone = TRUE WHERE type = 'page'")
	.then(function() {
		return knex.schema.raw("SELECT _id FROM block WHERE type='site'")
		.then(function(result) {
			return Promise.all(result.rows.map(processSite)).then(function() {
				console.info("Added", numFixes, "relations to sites");
			});
		});
	});
	function processSite(site) {
		return knex.schema.raw(`SELECT block._id FROM relation, block
		WHERE relation.parent_id = ${site._id}
		AND block._id = relation.child_id AND block.standalone IS TRUE`).then(function(result) {
			return Promise.all(result.rows.map(page => processPage(site, page)));
		});
	}
	function processPage(site, page) {
		// add a site relation for all children of page
		return knex.schema.raw(`SELECT block._id FROM relation, block
		WHERE relation.parent_id = ${page._id}
		AND block._id = relation.child_id`).then(function(result) {
			return Promise.all(result.rows.map(child => processChild(site, page, child)));
		});
	}
	function processChild(site, page, child) {
		return knex.schema.raw(`SELECT count(*) AS count FROM relation
		WHERE parent_id = ${site._id} AND child_id = ${child._id}`).then(function(result) {
			var row = result.rows[0];
			if (row.count == 1) return; // ok
			return knex.schema.raw(`INSERT INTO relation (parent_id, child_id)
			VALUES (${site._id}, ${child._id})`).then(function(result) {
				numFixes++;
			});
		});
	}
};



exports.down = function(knex) {

};
