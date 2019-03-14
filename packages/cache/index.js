const {tag, map} = require('upcache');
var pify = require('util').promisify;
var fs = {
	readFile: pify(require('fs').readFile),
	writeFile: pify(require('fs').writeFile),
	statSync: pify(require('fs').statSync)
};
var Path = require('path');
var Stringify = require('fast-json-stable-stringify');
var crypto = require('crypto');
var got = require('got');

var state = new CacheState();

exports = module.exports = function(opt) {
	exports.map = map;
	exports.tag = paramSiteWrap(tag);
	exports.for = paramSiteWrap(tag.for);
	exports.disable = tag.disable;
	exports.install = state.install.bind(state);
	return {
		init: function(All) {
			return state.init(All).then(function() {
				All.app.get('*', tag('app'));
				All.app.post('/.well-known/upcache', state.mw.bind(state), function(req, res) {
					res.sendStatus(204);
				});
			});
		},
		name: 'cache'
	};
};

function paramSiteWrap(fn) {
	return function() {
		var mw = fn.apply(null, Array.from(arguments));
		function omw(req, res, next) {
			req.params.site = req.site.id;
			mw(req, res, next);
		}
		if (mw.for) omw.for = paramSiteWrap(mw.for);
		return omw;
	};
}

function CacheState() {
}

CacheState.prototype.init = function(All) {
	this.opt = All.opt;
	this.path = Path.join(this.opt.dirs.data, 'cache.json');
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
	});
};

CacheState.prototype.install = function(site) {
	if (!site) {
		// because it's not possible to post without an actual url
		// app tag invalidation is postponed until an actual site is installed
		return;
	}
	setTimeout(function() {
		if (site.href) got.post(`${site.href}/.well-known/upcache`).catch(function(err) {
			console.error(err);
		});
	});
};

CacheState.prototype.mw = function(req, res, next) {
	var me = this;
	var tags = [];
	var doSave = false;
	var dobj = this.data;
	if (!dobj) dobj = this.data = {};
	console.info("Check app configuration changes");

	if (!this.hash) {
		var hash = crypto.createHash('sha256');
		hash.update(Stringify(this.opt));
		this.hash = hash.digest('hex');
	}
	if (dobj.hash === undefined) {
		doSave = true;
		dobj.hash = this.hash;
	} else if (dobj.hash != this.hash) {
		doSave = true;
		dobj.hash = this.hash;
		tags.push('app');
		console.info("detected application change");
	}
	tags.push('app-:site');
	exports.tag.apply(null, tags)(req, res, next);
	if (doSave) me.save();
};

