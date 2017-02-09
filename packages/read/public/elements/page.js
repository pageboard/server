(function() {

var PageElement = {};

PageElement.view = function(doc, block) {
	return doc;
};

Pagecut.modules.page = function(main) {
	main.elements.page = PageElement;
};

})();
