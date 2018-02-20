exports.up = function(knex) {
	return knex.schema.raw(`UPDATE block
	SET data = jsonb_set(jsonb_set(block.data, '{meta}', href.meta - 'thumbnail'), '{meta,mime}', to_jsonb(href.mime))
	FROM
	relation AS r,
	block AS p,
	href
	WHERE block.type = 'image'
	AND r.child_id = block._id AND p._id = r.parent_id
	AND p.type = 'site'
	AND href.site = p.data->>'domain' AND href.url = block.data->>'url'
	`);
};

exports.down = function(knex) {
	return knex.schema.raw(`UPDATE block SET data = data - 'meta' WHERE type='image'`);
};

