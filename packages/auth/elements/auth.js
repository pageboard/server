
Pageboard.elements.authName = {
	group: 'block',
	menu: 'user',
	render: function(doc, block) {
		var d = block.data;
		return doc.dom`<div class="username">${d.name}</div>`;
	}
}

Pageboard.elements.auth = {
	title: 'Validate',
	menu: 'user',
	icon: '<b class="icon">Auth</b>',
	group: 'block',
	mount: function(block, blocks, view) {
		var urlObj = Page.parse(document.location);
		if (urlObj.query.id) return GET('/.api/auth/activate', {
			id: urlObj.query.id
		}).then(function(validationBlock) {
			block.data.href = validationBlock.data.href;
		}).catch(function(err) {
			// in edit mode this can be safely ignored
			console.warn(err);
		});
	},
	contents: {
		text: "inline*"
	},
	render: function(doc, block) {
		var loc = document.location;
		if (!block.data.href) doc.head.appendChild(
			doc.dom`<meta http-equiv="Status" content="403 Forbidden">`
		);
		return doc.dom`<a class="ui auth button" href="${loc.protocol}//${loc.host}${block.data.href}" block-content="text">login</a>`;
	},
	stylesheets: [
		'../ui/auth.css'
	]
}
