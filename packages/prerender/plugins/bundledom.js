var fs = require('fs');
var Path = require('path');

module.exports = function(views, prefix) {
	if (!prefix) return noop;
	var dirname = Path.join(views, prefix);
	if (!fs.existsSync(dirname)) return noop;
	console.info("Enabled", dirname);
	return bundledomHelper.bind({prefix: prefix});
};

function bundledomHelper(mw, settings, req, res) {
	var view = settings.view || req.path;
	settings.view = Path.join(this.prefix, view);
}

function noop() {}

