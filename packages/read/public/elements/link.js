(function() {

var LinkElement = {
	name: 'link',
	group: 'block',
	specs: {
		content: "inline<_>*"
	},
	properties: {
		url: {
			title: 'Address',
			type: "string",
			format: "uri"
		},
		target: {
			title: 'Target',
			oneOf: [{
				constant: "_blank",
				title: "new window"
			}, {
				constant: "_self",
				title: "same window"
			}]
		}
	}
};

LinkElement.view = function(doc, block) {
	var anchor = doc.createElement('a');
	anchor.href = block.url || '?';
	anchor.setAttribute("block-content", "content");
	return anchor;
};

Pagecut.modules.link = function(main) {
	main.elements.link = LinkElement;
};

})();
