exports.up = function(knex) {
	// delete parent deletes the parent, child relation but might leave the child orphaned
	return knex.schema
	.raw(`CREATE OR REPLACE FUNCTION gc_orphaned_blocks() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	parents INTEGER;
BEGIN
	SELECT INTO parents count(*) FROM relation AS r WHERE r.child_id = OLD.child_id AND r.parent_id != OLD.parent_id;
	IF parents = 0 THEN
		DELETE FROM block WHERE _id = OLD.child_id AND type NOT IN ('site', 'user');
	END IF;
	RETURN OLD;
END $$`)
	.raw(`CREATE TRIGGER trigger_gc_orphaned_blocks
AFTER DELETE ON relation
FOR EACH ROW EXECUTE PROCEDURE gc_orphaned_blocks()`);
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP TRIGGER trigger_gc_orphaned_blocks ON relation")
	.raw("DROP FUNCTION IF EXISTS gc_orphaned_blocks()");
};

