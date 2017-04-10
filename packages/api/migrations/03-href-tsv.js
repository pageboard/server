// TODO use block lang to improve over unaccent
exports.up = function(knex) {
	return knex.schema
	.raw("ALTER TABLE href ADD COLUMN tsv tsvector")
	.raw(`CREATE OR REPLACE FUNCTION href_tsv_update() RETURNS trigger AS $$
BEGIN
	new.tsv := setweight(to_tsvector('unaccent', coalesce(new.title, '')), 'A') ||
		setweight(to_tsvector('unaccent', coalesce(new.description, '')), 'B') ||
		setweight(to_tsvector('unaccent', coalesce(new.url, '')), 'C')
		;
	RETURN new;
END
$$ LANGUAGE plpgsql`)
	.raw(`CREATE TRIGGER href_tsv_trigger BEFORE INSERT OR UPDATE
ON href FOR EACH ROW EXECUTE PROCEDURE href_tsv_update()`)
	.raw("CREATE INDEX index_href_tsv ON href USING gin(tsv)");
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP TRIGGER IF EXISTS href_tsv_trigger ON href")
	.raw("DROP FUNCTION IF EXISTS href_tsv_update()")
	.raw("ALTER TABLE href DROP COLUMN tsv");
};

