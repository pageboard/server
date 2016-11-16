#!/usr/bin/env node

var pageboard = require('../');

var opts = require(process.cwd() + '/package.json');
console.info(`${opts.name} ${opts.version}`);

pageboard(opts);

