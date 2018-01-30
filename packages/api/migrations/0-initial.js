exports.up = function(knex) {
	return knex.schema
	.createTable('block', function (table) {
		table.increments('_id').primary();
		table.string('id', 16).notNullable().unique();
		table.string('type').notNullable().index();
		table.jsonb('data').notNullable().defaultTo('{}');
		table.jsonb('content').notNullable().defaultTo('{}');
		table.jsonb('locks');
		table.jsonb('keys');
		table.string('lang');
		table.boolean('standalone').notNullable().defaultTo(false);
		table.timestamps(true, true); // created_at, updated_at, useTimestamps, defaultToNow
	})
	.createTable('relation', function (table) {
		table.increments('id').primary();
		table.integer('parent_id').notNullable()
		.unsigned().references('_id').inTable('block').onDelete('CASCADE');
		table.integer('child_id').notNullable()
		.unsigned().references('_id').inTable('block').onDelete('CASCADE');
	})
	.raw(
		"CREATE UNIQUE INDEX ON block ((data#>>'{url}'), lang) WHERE data->'url' IS NOT NULL"
	)
	.raw(
		"CREATE UNIQUE INDEX ON block ((data#>>'{domain}')) WHERE type='site'"
	)
	.raw(
		"CREATE UNIQUE INDEX ON block ((data#>>'{email}')) WHERE type='user'"
	)
	.raw(
		"CREATE INDEX ON block (updated_at DESC)"
	)
	.createTable('href', function(table) {
		table.increments('_id').primary();
		table.integer('_parent_id').unsigned().references('_id').inTable('block').onDelete('CASCADE');
		table.string('url').notNullable();
		table.boolean('visible').notNullable().defaultTo(true);
		table.string('mime').notNullable().index();
		table.string('type').notNullable();
		table.string('title').notNullable();
		table.string('icon');
		table.string('site').notNullable();
		table.string('pathname').notNullable();
		table.jsonb('meta').notNullable().defaultTo('{}');
		table.string('lang');
		table.timestamps(true, true); // created_at, updated_at, useTimestamps, defaultToNow
	})
	.raw(
		"CREATE UNIQUE INDEX ON href (_parent_id, url, lang)"
	)
	.raw(
		"CREATE INDEX ON href (updated_at DESC)"
	)
	;
};

exports.down = function(knex) {
	return knex.schema
		.dropTableIfExists('href')
		.dropTableIfExists('relation')
		.dropTableIfExists('block');
};

