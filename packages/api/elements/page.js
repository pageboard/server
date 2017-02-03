var Page = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = Page;
}

Page.name = "page";
Page.required = ['template'];
Page.properties = {
	title: {
		type: ['string', 'null']
	},
	template: {
		type: 'string'
	}
};

