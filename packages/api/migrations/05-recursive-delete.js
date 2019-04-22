exports.up = function(knex) {
	return knex.schema
	.raw(`CREATE OR REPLACE FUNCTION recursive_delete(root_id INTEGER, standalones BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql AS
$$
DECLARE
	deleted INTEGER;
BEGIN
	WITH RECURSIVE child_blocks(child_id, _id, path, cycle) AS (
		SELECT b._id AS child_id, 0 AS _id, ARRAY[0], FALSE
		FROM block AS b
		WHERE b._id = root_id
	UNION ALL
		SELECT r.child_id, cb.child_id AS _id, path || cb.child_id, cb.child_id = ANY(path)
		FROM child_blocks AS cb, relation AS r, block AS b
		WHERE r.parent_id = cb.child_id AND b._id = r.parent_id AND (b.standalone IS FALSE OR standalones IS TRUE)
	)
	DELETE FROM block WHERE _id IN (SELECT child_blocks.child_id AS _id FROM child_blocks ORDER BY child_blocks.path DESC);
	GET DIAGNOSTICS deleted = ROW_COUNT;
	RETURN deleted;
END
$$
VOLATILE;`);
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP FUNCTION IF EXISTS recursive_delete(INTEGER, BOOLEAN)");
};

