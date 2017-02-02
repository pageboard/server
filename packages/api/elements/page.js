var Page = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = Page;
}

Page.name = "page";
Page.required = ['title'];
Page.properties = {
	title: {
		type: 'string'
	}
};

