(function(exports) {

exports.site = {
	required: ['name'],
	properties : {
		name: {
			type: 'string'
		}
	}
};

})(typeof exports == "undefined" ? window.Pagecut.modules : exports);
