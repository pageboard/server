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
	exports.tag = tag;
	exports.disable = tag.disable;
	exports.install = state.install.bind(state);
	return {
		init: function(All) {
			return state.init(All).then(function() {
				All.app.get('*', tag('app'));
				All.app.post('/.upcache', state.mw.bind(state), function(req, res) {
					res.sendStatus(204);
				});
			});
		},
		name: 'cache'
	};
};

function CacheState() {
	this.mtime = 0;
}

CacheState.prototype.init = function(All) {
	this.opt = All.opt;
	this.path = Path.join(opt.dirs.data, 'cache.json');
	this.mtimes = {};
	return this.open();
};

CacheState.prototype.saveNow = function() {
	delete this.toSave;
	var me = this;
	return fs.writeFile(this.path, JSON.stringify(this.data)).catch(function(err) {
		console.error("Error writing", me.path);
	});
};

CacheState.prototype.save = function() {
	if (this.toSave) clearTimeout(this.toSave);
	this.toSave = setTimeout(this.saveNow.bind(this), 5000);
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
		if (!me.data.domains) me.data.domains = {};
	});
};

CacheState.prototype.install = function(domain, opt, All) {
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
	var domain = req.hostname;
	var dobj = this.data.domains[domain];
	if (!dobj) dobj = this.data.domains[domain] = {};


	if (!this.digest) {
		var hash = crypto.createHash('sha256');
		hash.update(Stringify(this.opt));
		this.hash = hash.digest('hex');
	}
	if (dobj.hash === undefined) {
		doSave = true;
		dobj.hash = this.hash;
	} else if (dobj.hash != this.hash) {
		console.info(`app tag changes for domain ${domain}`);
		doSave = true;
		dobj.hash = this.hash;
		tags.push('app');
	}
	this.refreshMtime().then(function(mtime) {
		if (dobj.share === undefined) {
			doSave = true;
			dobj.share = mtime;
		} else if (mtime > dobj.share) {
			console.info(`share tag changes for domain ${domain}`);
			doSave = true;
			dobj.share = mtime;
			tags.push('share');
		}
		return me.refreshMtime(domain);
	}).then(function(mtime) {
		if (dobj.file === undefined) {
			doSave = true;
			dobj.file = mtime;
		} else if (mtime > dobj.file) {
			console.info(`file tag changes for domain ${domain}`);
			doSave = true;
			dobj.file = mtime;
			tags.push('file');
		}
	}).then(function() {
		if (tags.length) tag.apply(null, tags)(req, res, next);
		else next();
		if (doSave) me.save();
	});
}

CacheState.prototype.refreshMtime = function(domain) {
	var dir = Path.join(this.opt.statics.runtime, domain ? 'files/' + domain : 'pageboard');
	var mtime = this.mtimes[domain || 'pageboard'];
	if (mtime !== 0) return Promise.resolve(mtime);
	mtime = 0;
	var pattern = dir + '/**';
	var me = this;

	return new Promise(function(resolve, reject) {
		var g = new Glob(pattern, { stat: true, nodir: true });
		g.on('stat', function(file, stat) {
			var ftime = stat.mtime.getTime();
			if (ftime > mtime) mtime = ftime;
		})
		g.on('end', function() {
			me.mtimes[domain || 'pageboard'] = mtime;
			resolve(mtime);
		});
		// not sure if end always happen, nor if error happens once
		// g.on('error', reject)
	});
};
