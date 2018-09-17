const pify = require('util').promisify;
const mkdir = pify(require('fs').mkdir);
const pexec = pify(require('child_process').exec);
const pjoin = require('path').join;
const dependencies = require('./package.json').dependencies;

Promise.all([
	mkdir(pjoin(__dirname, 'node_modules')).catch(function() {}).then(function() {
		return mkdir(pjoin(__dirname, 'node_modules', '@pageboard')).catch(function() {});
	})
]).then(function() {
	return Promise.all(Object.keys(dependencies).filter(function(name) {
		return name.startsWith('@pageboard/');
	}).map(function(name) {
		var repPath = pjoin('repositories', name.split('/').pop());
		var absTgt = pjoin(__dirname, 'node_modules/@pageboard/');
		return pexec(`ln -sf ../../${repPath} ${absTgt}`, {
			cwd: __dirname
		}).then(function({stdout, stderr}) {
			if (stdout) console.log(stdout);
			if (stderr) console.error(stderr);
		});
	})).catch(function(err) {
		console.error(err);
		process.exit(1);
	});
});
