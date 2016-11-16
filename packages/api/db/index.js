var objection = require('objection');
var knex = require('knex');
// access to .pgpass requires HOME to be set
if (!process.env.HOME) process.env.HOME = require('passwd-user').sync(process.getuid()).homedir;

module.exports = function(config) {
	console.log(require('./knexfile'), config.env)
	var knexConfig = require('./knexfile')[config.env];
	console.log(knexConfig);
	objection.Model.knex(knex(knexConfig));
	return objection;
};

