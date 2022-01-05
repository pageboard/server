exports.up = function (knex) {
	return knex.schema
		.raw(`DROP INDEX IF EXISTS block_id_index`)
		.raw(`ALTER TABLE block ADD CONSTRAINT block_id_unique UNIQUE(id) DEFERRABLE INITIALLY DEFERRED`);
};

exports.down = function (knex) {
	return knex.schema
		.raw(`ALTER TABLE block DROP CONSTRAINT block_id_unique`)
		.raw(`CREATE UNIQUE INDEX ON block (id)`);
};
