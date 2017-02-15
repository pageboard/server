(function() {

var LinkElement = {
	name: 'link',
	group: 'block',
	specs: {
		content: "inline<_>*"
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
