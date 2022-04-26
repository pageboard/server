exports.up = async (knex) => {
	const results = await knex.schema.raw(`select block.id, block.type, block.content from block, relation r, block p where block.type = 'page' and block._id = r.child_id and r.parent_id=p._id and p.type='site' and block.content='{}'::jsonb`);
	await results.rows.forEach(async (row) => {
		const results = await knex.schema.raw(`SELECT block.id, block.type FROM block, relation r, block p WHERE p.id='${row.id}' AND r.parent_id = p._id AND block._id = r.child_id AND block.type IN ('header', 'main', 'footer')`);
		const parts = {
			header: [],
			main: [],
			footer: []
		};
		results.rows.forEach(section => {
			parts[section.type].push(section.id);
		});

		const content = [
			...parts.header.map(
				id => `<element-sticky block-id="${id}"></element-sticky>`
			),
			...parts.main.map(
				id => `<main block-id="${id}"></main>`
			),
			...parts.footer.map(
				id => `<footer block-id="${id}"></footer>`
			)
		];
		const contStr = JSON.stringify({
			body: content.join('')
		});
		await knex.schema.raw(
			"UPDATE block SET content=?::jsonb WHERE id=?",
			[contStr, row.id]
		);
	});
};

exports.down = function(knex) {

};

