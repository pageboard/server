var PageSchema = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = PageSchema;
}

PageSchema.name = "user";
PageSchema.required = ['title'];
PageSchema.properties = {
	title: {
		type: 'string'
	}
};

