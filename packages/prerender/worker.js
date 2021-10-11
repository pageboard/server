const dom = require('express-dom');
const Path = require('path');
const {PassThrough} = require('stream');

class FakeRequest {
	constructor(params) {
		Object.assign(this, params);
	}
	get(key) {
		return this.headers[key];
	}
}

class FakeResponse extends PassThrough {
	constructor() {
		super();
		this.headers = {};
		this.priv = {};
		this.on('pipe', () => {
			let done = false;
			this.on('error', (err) => {
				if (done) return;
				done = true;
				this.ipc(err);
			});
			this.on('finish', () => {
				if (done) return;
				done = true;
				this.ipc({
					piped: true,
					finished: true
				});
			});
			this.pipe(process.stdout);
			this.priv.piped = true;
			this.ipc();
		});
	}
	ipc(msg) {
		if (msg) {
			if (msg instanceof Error) {
				msg = {err: errObject(msg)};
			}
		} else {
			if (this.priv.sent) {
				console.error("prerender render tried to send message twice");
				return;
			}
			this.priv.sent = true;
			msg = Object.assign({}, this.priv, {
				headers: this.headers,
				statusCode: this.statusCode
			});
		}
		process.send(msg);
	}
	status(code) {
		this.statusCode = code;
	}
	sendStatus(code) {
		this.status(code);
		this.ipc();
	}
	json(data) {
		this.priv.body = data;
		this.ipc();
	}
	send(data) {
		this.priv.body = data;
		this.ipc();
	}
	get(name) {
		return this.headers[name] ? this.headers[name].split(',') : [];
	}
	set(name, val) {
		this.headers[name] = val;
	}
	attachment(str) {
		this.priv.attachment = str;
	}
	sendFile(path) {
		this.priv.file = path;
	}
	append(name, val) {
		let list = this.headers[name];
		if (!list) list = val;
		else list += "," + val;
		this.headers[name] = list;
	}
	type(val) {
		this.headers['Content-Type'] = val;
	}
}

let initialized = false;

function init(opt) {
	initialized = true;
	if (opt.clear) {
		delete opt.clear;
		dom.clear();
	}
	global.All = {opt: opt};
	const conf = opt.prerender;

	conf.helpers.forEach((path) => {
		const mod = require(path);
		const name = Path.basename(path, Path.extname(path));
		dom.helpers[name] = mod.helper || mod;
	});
	delete conf.helpers;

	conf.plugins.forEach((path) => {
		const mod = require(path);
		const name = Path.basename(path, Path.extname(path));
		dom.plugins[name] = mod.plugin || mod;
	});
	delete conf.plugins;

	Object.assign(dom.settings, conf);

	dom.pool.max = 1;
	dom.pool.min = 1;
}

function run(params) {
	const req = new FakeRequest(params);
	const res = new FakeResponse();

	params.helpers.forEach((name) => {
		const fn = dom.helpers[name];
		if (fn) dom.settings.helpers.push(fn);
		else console.error("Prerender missing helper", name);
	});
	dom((mw, settings, request, response) => {
		settings.view = params.view;
		settings.load.plugins = params.plugins.map((name) => {
			const fn = dom.plugins[name];
			if (fn) return fn;
			else console.error("Prerender missing plugin", name);
		});
		Object.assign(settings, params.settings);
	}).load()(req, res, (err) => {
		res.ipc(err);
	});
}

process.on("message", (msg) => {
	if (!initialized) init(msg);
	else run(msg);
});

function errObject(err) {
	return {
		name: err.name,
		message: err.message,
		stack: err.stack,
		statusCode: err.statusCode,
		code: err.code
	};
}
