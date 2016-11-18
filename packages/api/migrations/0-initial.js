exports.up = function (knex) {
	return knex.schema
	.createTable('site', function (table) {
		table.increments('id').primary();
		table.text('domain').index().notNullable();
		table.text('name');
	})
	.createTable('block', function (table) {
		table.increments('id').primary();
		table.string('type').notNullable().index();
		table.string('mime').notNullable().index();
		table.jsonb('data').notNullable().defaultTo('{}');
		table.jsonb('content').notNullable().defaultTo('{}');
		table.string('lang').index();
		table.string('url').index();
		table.string('template').index();
		table.integer('site_id').unsigned().notNullable().references('id').inTable('site').onDelete('CASCADE');
	})
	.createTable('relation', function (table) {
		table.increments('id').primary();
		table.integer('parent_id').unsigned().references('id').inTable('block').onDelete('CASCADE');
		table.integer('child_id').unsigned().references('id').inTable('block').onDelete('CASCADE');
	})
	.createTable('permission', function (table) {
		table.increments('id').primary();
		table.string('name').index().unique();
	})
	.createTable('user', function (table) {
		table.increments('id').primary();
		table.string('email').index().unique().notNullable();
		table.string('password').notNullable();
		table.string('name');
		table.string('firstname');
	})
	.createTable('user_permission', function (table) {
		table.increments('id').primary();
		table.boolean('read').defaultTo(false);
		table.boolean('add').defaultTo(false);
		table.boolean('save').defaultTo(false);
		table.boolean('del').defaultTo(false);
		table.integer('user_id').unsigned().notNullable().references('id').inTable('user').onDelete('CASCADE');
		table.integer('permission_id').unsigned().notNullable().references('id').inTable('permission').onDelete('CASCADE');
	}).then(function() {
		// unique index doesn't equal two null values so it's okay to do that
		return knex.schema.raw("CREATE UNIQUE INDEX index_unique_block_site_id_data_url ON block(site_id, (data->>'url'))");
	});
};

exports.down = function (knex) {
	return knex.schema
		.dropTableIfExists('relation')
		.dropTableIfExists('block')
		.dropTableIfExists('site')
		.dropTableIfExists('user_permission')
		.dropTableIfExists('permission')
		.dropTableIfExists('user');
};
