var config = require('..').config();

module.exports = {};
module.exports[config.env] = knexConfig(config);

function knexConfig(config) {
	var parsed = require('url').parse(config.database, true);
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
		directory: './api/seeds/' + config.env
	};
	return obj;
}

