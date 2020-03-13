exports.up = async (knex) => {
	const results = await knex.schema.raw(`select block.id, block.type, block.content from block, relation r, block p where block.type = 'page' and block._id = r.child_id and r.parent_id=p._id and p.type='site' and block.content='{}'::jsonb`);
	await results.rows.forEach(async (row) => {
		const results = await knex.schema.raw(`SELECT block.id, block.type FROM block, relation r, block p WHERE p.id='${row.id}' AND r.parent_id = p._id AND block._id = r.child_id AND block.type IN ('header', 'main', 'footer')`);
		const parts = {
			header: [],
			main: [],
			footer: []
		};
		results.rows.forEach((section) => {
			parts[section.type].push(section.id);
		});
		let content = parts.header.map((id) => {
			return `<element-sticky block-id="${id}"></element-sticky>`;
		});
		content = content.concat(parts.main.map((id) => {
			return `<main block-id="${id}"></main>`;
		}));
		content = content.concat(parts.footer.map((id) => {
			return `<footer block-id="${id}"></footer>`;
		}));
		content = JSON.stringify({body: content.join('')});
		await knex.schema.raw(`UPDATE block SET content='${content}'::jsonb WHERE id='${row.id}'`);
	});
};

exports.down = function(knex) {

};

