exports.up = function(knex) {
	return knex.schema
	.raw("CREATE TEXT SEARCH CONFIGURATION unaccent ( COPY = simple )")
	.raw(`ALTER TEXT SEARCH CONFIGURATION unaccent
ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple`);
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP TEXT SEARCH CONFIGURATION unaccent CASCADE");
};

