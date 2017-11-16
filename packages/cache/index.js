var tag = require('upcache/tag');
var pify = require('util').promisify;
var fs = {
	readFile: pify(require('fs').readFile),
	writeFile: pify(require('fs').writeFile),
	statSync: pify(require('fs').statSync)
};
var Glob = require('glob').Glob;
var Path = require('path');
var Stringify = require('fast-json-stable-stringify');
var crypto = require('crypto');
var got = require('got');

var state = new CacheState();

exports = module.exports = function(opt) {
	return {
		init: function(All) {
			return state.init(All).then(function() {
				All.app.get('*', tag('app'));
				All.app.post('/.upcache', state.mw.bind(state), function(req, res) {
					res.sendStatus(204);
				});
			});
		},
		tag: tag,
		install: state.install.bind(state),
		name: 'cache'
	};
};

function CacheState() {
	this.mtime = 0;
}

CacheState.prototype.init = function(opt) {
	this.opt = opt;
	this.path = Path.join(opt.dirs.data, 'cache.json');
	return this.open();
};

CacheState.prototype.save = function() {
	var me = this;
	return fs.writeFile(this.path, JSON.stringify(this.data)).catch(function(err) {
		console.error("Error writing", me.path);
	});
};

CacheState.prototype.open = function() {
	var me = this;
	return fs.readFile(this.path, {flag: 'a+'}).then(function(buf) {
		var str = buf.toString();
		if (!str) return;
		return JSON.parse(str);
	}).catch(function(err) {
		console.info(`Unparsable ${me.path}, continuing anyway`);
	}).then(function(data) {
		me.data = data || {};
	});
};

CacheState.prototype.install = function(domain, All, opt) {
	if (!domain) return;
	var obj = All.domains.map[domain];
	if (!obj) throw new Error(`Domain ${domain} not requested before install`);
	return got.post(`${obj.host}/.upcache`).catch(function(err) {
		// we don't want to crash in case of error
		console.error(err);
	});
};

CacheState.prototype.mw = function(req, res, next) {
	var me = this;
	var tags = [];
	var doSave = false;

	var hash = crypto.createHash('sha256');
	hash.update(Stringify(this.opt));
	var digest = hash.digest('hex');

	if (this.data.hash) {
		if (this.data.hash != digest) {
			tags.push('app');
			doSave = true;
			console.info(`app tag changes`);
		}
	} else {
		doSave = true;
		this.data.hash = digest;
	}
	this.refreshMtime().then(function(mtime) {
		if (me.data.mtime === undefined) {
			doSave = true;
			me.data.mtime = mtime;
		} else if (mtime > me.data.mtime) {
			console.info('static tag changes');
			doSave = true;
			me.data.mtime = mtime;
			tags.push('static');
		}
	}).then(function() {
		if (tags.length) tag.apply(null, tags)(req, res, next);
		else next();
		if (doSave) me.save();
	});
}

CacheState.prototype.refreshMtime = function() {
	if (this.mtime !== 0) return Promise.resolve(this.mtime);
	var dirs = this.opt.statics.runtime;
	// returns the last mtime of files in a list of directories and their subtrees
	var pattern = Array.isArray(dirs)
		? '{' + dirs.join(',') + '}/**'
		: dirs + '/**';

	return new Promise(function(resolve, reject) {
		var mtime = 0;
		var g = new Glob(pattern, { stat: true, nodir: true });
		g.on('stat', function(file, stat) {
			var ftime = stat.mtime.getTime();
			if (ftime > mtime) mtime = ftime;
		})
		g.on('end', function() {
			resolve(mtime);
		});
		// not sure if end always happen, nor if error happens once
		// g.on('error', reject)
	});
};
