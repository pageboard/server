exports.up = function(knex) {
	return knex.schema
	.raw("ALTER TABLE block ADD COLUMN tsv tsvector")
	.raw(`CREATE OR REPLACE FUNCTION block_tsv_update() RETURNS trigger AS $$
BEGIN
	new.tsv := to_tsvector(string_agg(value, ' ')) FROM jsonb_each_text(new.content);
	RETURN new;
END
$$ LANGUAGE plpgsql`)
	.raw(`CREATE TRIGGER block_tsv_trigger BEFORE INSERT OR UPDATE
ON block FOR EACH ROW EXECUTE PROCEDURE block_tsv_update()`)
	.raw("CREATE INDEX index_block_tsv ON block USING gin(tsv)");
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP TRIGGER IF EXISTS block_tsv_trigger ON block")
	.raw("DROP FUNCTION IF EXISTS block_tsv_update()")
	.raw("ALTER TABLE block DROP COLUMN tsv");
};






