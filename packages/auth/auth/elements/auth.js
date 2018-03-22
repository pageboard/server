Pageboard.elements.login = {
	title: 'Login',
	menu: 'link',
	icon: '<i class="user icon"></i>',
	group: 'block',
	mount: function(block, blocks, view) {
		var urlObj = Page.parse(document.location);
		if (!urlObj.query.to) return;
		return fetch('/.api/auth/login?id=' + encodeURIComponent(urlObj.query.to), {
			credentials: "same-origin"
		}).then(function(res) {
			return res.json();
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
		var href = `${loc.protocol}//${loc.host}${block.data.href}`;
		var anchor = doc.dom`<a class="ui auth button" href="${href}" block-content="text">login</a>`;
		var action = doc.getElementById('loginAction');
		if (action) action.remove();
		var ld = {
			"@context": "http://schema.org",
			"@type": "EmailMessage",
			"potentialAction": {
				"@type": "ViewAction",
				"target": href,
				"name": "Login"
			},
			"description": anchor.innerText
		};
		doc.head.insertAdjacentHTML('beforeEnd', `<script type="application/ld+json" id="loginAction">${JSON.stringify(ld)}</script>`);
		return anchor;
	},
	stylesheets: [
		'../ui/auth.css'
	],
	polyfills: ['fetch']
};
