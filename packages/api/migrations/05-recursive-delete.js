exports.up = function(knex) {
	return knex.schema
	.raw(`CREATE OR REPLACE FUNCTION recursive_delete(root_id INTEGER, standalones BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql AS
$$
DECLARE
	deleted INTEGER;
BEGIN
	WITH RECURSIVE children(_id, parent_id, path, cycle) AS (
		SELECT b._id, 0 AS parent_id, ARRAY[0], FALSE
		FROM block AS b
		WHERE b._id = root_id
	UNION ALL
		SELECT b._id, r.parent_id, path || b._id, children._id = ANY(path)
		FROM children, relation AS r, block AS b
		WHERE r.parent_id = children._id AND b._id = r.child_id AND (b.standalone IS FALSE OR standalones IS TRUE)
	)
	DELETE FROM block WHERE _id IN (SELECT _id FROM children ORDER BY path DESC);
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

