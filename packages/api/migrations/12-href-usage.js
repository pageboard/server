exports.up = function(knex) {
	return knex.schema.raw(`ALTER TABLE href ADD COLUMN IF NOT EXISTS usage INTEGER`).then(function() {
		return knex.schema.raw(`UPDATE href SET
			updated_at = now(),
			usage = us.count
		FROM (
			SELECT count(c.*) AS count, h._id FROM href AS h, block AS p, relation AS r, block AS c
			WHERE p.type = 'site' AND p.data->>'domain' = h.site
			AND r.parent_id = p._id AND c._id = r.child_id AND c.data->>'url' = h.url
			GROUP BY h._id
		) AS us
		WHERE us._id = href._id
		`);
	});
};

exports.down = function(knex) {};

