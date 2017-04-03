exports.up = function (knex) {
	return knex.schema
	.createTable('block', function (table) {
		table.increments('id').primary();
		table.string('type').notNullable().index();
		table.string('mime').notNullable().index();
		table.jsonb('data').notNullable().defaultTo('{}');
		table.jsonb('content').notNullable().defaultTo('{}');
		table.string('lang');
		table.jsonb('permissions').defaultTo('{"read": [], "add": [], "save": [], "del": []}');
	})
	.createTable('relation', function (table) {
		table.increments('id').primary();
		table.integer('parent_id').unsigned().references('id').inTable('block').onDelete('CASCADE');
		table.integer('child_id').unsigned().references('id').inTable('block').onDelete('CASCADE');
	});
	// TODO create index on type=user, data.email
};

exports.down = function (knex) {
	return knex.schema
		.dropTableIfExists('relation')
		.dropTableIfExists('block');
};
