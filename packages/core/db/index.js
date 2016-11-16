var objection = require('objection');
var knex = require('knex');
var knexFile = require('./knexfile');
// access to .pgpass requires HOME to be set
if (!process.env.HOME) process.env.HOME = require('passwd-user').sync(process.getuid()).homedir;

module.exports = function(config) {
	objection.Model.knex(knex(knexFile[config.env]));
	return objection;
};

