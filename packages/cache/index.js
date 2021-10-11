const Upcache = require.lazy('upcache');
const fs = require('fs').promises;
const Path = require('path');
const Stringify = require.lazy('fast-json-stable-stringify');
const crypto = require('crypto');
const got = require.lazy('got');

const state = new CacheState();

exports = module.exports = function(opt) {
	exports.install = state.install.bind(state);
	return {
		init: init,
		name: 'cache'
	};
};

function init(All) {
	All.cache.map = Upcache.map;
	All.cache.tag = paramSiteWrap(Upcache.tag);
	All.cache.for = paramSiteWrap(Upcache.tag.for);
	All.cache.disable = Upcache.tag.disable;
	return state.init(All).then(() => {
		All.app.get('*', Upcache.tag('app'));
		All.app.post('/.well-known/upcache', state.mw.bind(state), (req, res) => {
			res.sendStatus(204);
		});
	});
}

function paramSiteWrap(fn) {
	return function() {
		const mw = fn.apply(null, Array.from(arguments));
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
	const me = this;
	return fs.writeFile(this.path, JSON.stringify(this.data)).catch((err) => {
		console.error("Error writing", me.path);
	});
};

CacheState.prototype.save = function() {
	if (this.toSave) clearTimeout(this.toSave);
	this.toSave = setTimeout(this.saveNow.bind(this), 5000);
};

CacheState.prototype.open = function() {
	const me = this;
	return fs.readFile(this.path, {flag: 'a+'}).then((buf) => {
		const str = buf.toString();
		if (!str) return;
		return JSON.parse(str);
	}).catch((err) => {
		// eslint-disable-next-line no-console
		console.info(`Unparsable ${me.path}, continuing anyway`);
	}).then((data) => {
		me.data = data || {};
	});
};

CacheState.prototype.install = function(site) {
	if (!site) {
		// because it's not possible to post without an actual url
		// app tag invalidation is postponed until an actual site is installed
		return;
	}
	setTimeout(() => {
		if (site.href) got.post(`${site.href}/.well-known/upcache`, {
			timeout: 5000
		}).catch((err) => {
			console.error(err);
		});
	});
};

CacheState.prototype.mw = function(req, res, next) {
	const me = this;
	const tags = [];
	let doSave = false;
	let dobj = this.data;
	if (!dobj) dobj = this.data = {};
	// eslint-disable-next-line no-console
	console.info("Check app configuration changes");

	if (!this.hash) {
		const hash = crypto.createHash('sha256');
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
		// eslint-disable-next-line no-console
		console.info("detected application change");
	}
	tags.push('app-:site');
	All.cache.tag.apply(null, tags)(req, res, next);
	if (doSave) me.save();
};

