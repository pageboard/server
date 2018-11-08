exports.up = function(knex) {
	return knex.schema.raw(`SELECT r.id, r.parent_id, r.child_id
		FROM relation AS r, (SELECT parent_id, child_id FROM relation group by parent_id, child_id HAVING count(*) > 1) AS doubles
		WHERE r.parent_id = doubles.parent_id AND r.child_id = doubles.child_id
		ORDER BY r.child_id, r.parent_id
	`).then(function(list) {
		var ids = [];
		var couples = {};
		console.info("Deleting these relations");
		list.rows.forEach(function(row) {
			var pair = `${row.parent_id}-${row.child_id}`;
			if (couples[pair]) {
				console.info(row);
				ids.push(row.id);
			}	else {
				couples[pair] = true;
			}
		});
		return knex.schema.raw(`
			DELETE FROM relation WHERE id IN (${ids.join(',')})
		`).then(function() {
			return knex.schema.raw(
				"CREATE UNIQUE INDEX ON relation (parent_id, child_id)"
			);
		});
	});
};

exports.down = function(knex) {

};

