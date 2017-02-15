(function() {

var PageElement = {
	name: 'page'
};

PageElement.view = function(doc, block) {
	return doc.documentElement;
};

Pagecut.modules.page = function(main) {
	main.elements.page = PageElement;
};

})();
