const pify = require('util').promisify;
const mkdir = pify(require('fs').mkdir);
const link = pify(require('fs').link);
const pexec = pify(require('child_process').exec);
const faccess = pify(require('fs').access);
const pjoin = require('path').join;
const dependencies = require('./package.json').dependencies;

Promise.all([
	mkdir(pjoin(__dirname, 'repositories')).catch(function() {}),
	mkdir(pjoin(__dirname, 'node_modules')).catch(function() {}).then(function() {
		return mkdir(pjoin(__dirname, 'node_modules', '@pageboard')).catch(function() {});
	})
]).then(function() {
	return Object.keys(dependencies).filter(function(name) {
		return name.startsWith('@pageboard/');
	}).reduce(function(chain, name) {
		var repName = name.split('/').pop();
		var repPath = pjoin('repositories', repName);
		return faccess(pjoin(__dirname, repPath)).catch(function() {
			var url = `git@github.com:${name.substring(1)}.git`;
			return chain.then(function() {
				return pexec(`git submodule add ${url} ${repPath}`, {
					cwd: __dirname
				}).then(function({stdout, stderr}) {
					if (stdout) console.log(stdout);
					if (stderr) console.error(stderr);
				});
			}).then(function() {
				var absTgt = pjoin(__dirname, 'node_modules/@pageboard/');
				return pexec(`ln -sf ../../${repPath} ${absTgt}`, {
					cwd: __dirname
				}).then(function({stdout, stderr}) {
					if (stdout) console.log(stdout);
					if (stderr) console.error(stderr);
				});
			});
		});
	}, Promise.resolve()).then(function() {
		console.log("All submodules added");

	}).catch(function(err) {
		console.error(err);
		process.exit(1);
	});
});
