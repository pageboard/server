#!/usr/bin/env node

var pageboard = require('../');

var config = pageboard.config();

console.info(`${config.name} ${config.version}`);

pageboard.init(config);

