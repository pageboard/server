Pageboard.elements.login = {
	title: 'Login',
	menu: 'user',
	icon: '<i class="user icon"></i>',
	group: 'block',
	mount: function(block, blocks, view) {
		var urlObj = Page.parse(document.location);
		if (urlObj.query.to) return GET('/.api/auth/login', {
			id: urlObj.query.to
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
};
