const dom = require('express-dom');
const Path = require('path');

class FakeRequest {
	constructor(params) {
		Object.assign(this, params);
	}
	get(key) {
		return this.headers[key];
	}
}

class FakeResponse {
	constructor() {
		this.headers = {};
	}
	status(code) {
		this.code = code;
	}
	sendStatus(code) {
		this.status(code);
		send(this);
	}
	send(data) {
		this.body = data;
		send(this);
	}
	get(name) {
		return this.headers[name] ? this.headers[name].split(',') : [];
	}
	set(name, val) {
		this.headers[name] = val;
	}
	append(name, val) {
		var list = this.headers[name];
		if (!list) list = val;
		else list += "," + val;
		this.headers[name] = list;
	}
}

function send(obj) {
	process.send(obj);
}
var initialized = false;

function init(opt) {
	initialized = true;
	global.All = {opt: opt};
	var conf = opt.prerender;

	conf.helpers.forEach(function(path) {
		var mod = require(path);
		var name = Path.basename(path, Path.extname(path));
		dom.helpers[name] = mod.helper || mod;
	});

	conf.plugins.forEach(function(path) {
		var mod = require(path);
		var name = Path.basename(path, Path.extname(path));
		dom.plugins[name] = mod.plugin || mod;
	});

	Object.assign(dom.settings, conf.settings);

	dom.pool.max = 1;
	dom.pool.min = 1;

	dom.clear();
}

function run(params) {
	var req = new FakeRequest(params);
	var res = new FakeResponse();
	params.helpers.forEach(function(name) {
		var fn = dom.helpers[name];
		if (fn) dom.settings.helpers.push(fn);
		else console.error("Prerender missing helper", name);
	});
	dom(function(mw, settings) {
		settings.view = params.view;
		settings.load.plugins = params.plugins.map(function(name) {
			var fn = dom.plugins[name];
			if (fn) return fn;
			else console.error("Prerender missing plugin", name);
		});
	}).load()(req, res, function(err) {
		if (err) send({err: errObject(err)});
		else send(res);
	});
}

process.on("message", function(msg) {
	if (!initialized) init(msg);
	else run(msg);
});

function errObject(err) {
	return {
		name: err.name,
		message: err.message,
		stack: err.stack
	};
}
