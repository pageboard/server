var config = require('..').config();

function getConfig(env, obj) {
	if (!obj[env]) throw new Error("No config for " + env);
	var parsed = require('url').parse(obj[env].database, true);
	var conn = {};
	var obj = { connection: conn };
	if (parsed.host) conn.host = parsed.host;
	if (parsed.pathname) conn.database = parsed.pathname.substring(1);
	if (parsed.auth) {
		var auth = parsed.auth.split(':');
		conn.user = auth[0];
		if (auth.length > 1) conn.password = auth[1];
	}
	obj.client = parsed.protocol.slice(0, -1);
	obj.debug = !!parseInt(parsed.query.debug);
	obj.migrations = {
		directory: './api/migrations'
	};
	obj.seeds = {
		directory: './api/seeds/' + env
	};
	return obj;
}

module.exports = {
	development: getConfig('development', config),
	staging: getConfig('staging', config),
	production: getConfig('production', config)
};

