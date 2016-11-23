var SiteSchema = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = SiteSchema;
}

SiteSchema.name = "site";
SiteSchema.required = ['name'];
SiteSchema.properties = {
	name: {
		type: 'string'
	}
};

