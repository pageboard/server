var Site = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = Site;
}

Site.name = "site";
Site.required = ['name'];
Site.properties = {
	name: {
		type: 'string'
	}
};

