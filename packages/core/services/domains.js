const { promises: dns, setDefaultResultOrder } = require('node:dns');
const { performance } = require('node:perf_hooks');
const { Deferred } = require('class-deferred');


// const localhost4 = "127.0.0.1";
// const localhost6 = "::1";
setDefaultResultOrder("ipv4first");

const [
	INIT,
	BUSY,
	READY,
	PARKED
] = Array.from({ length: 4 }, (_, i) => Symbol(i));



class Host {
	tenants = {};
	#held = true;
	#hold = new Deferred();
	state = INIT;

	constructor(id) {
		this.id = id;
	}
	reset() {
		this.state = INIT;
		this.release();
	}
	async wait() {
		await this.#hold;
	}
	hold() {
		if (!this.#held) {
			this.#hold = new Deferred();
			this.#held = true;
		}
	}
	release() {
		if (this.#held) {
			this.#held = false;
			this.#hold.resolve();
		}
	}
}

module.exports = class DomainsService {
	static priority = -Infinity;
	static name = "domains";

	#wait = new Deferred();
	#ips = {};
	#suffixes = [];
	#allDomainsCalled = false;
	#idByDomain = new Map();
	#hostById = {};
	#siteById = {};
	#domains;
	#hasLoggedMissingDomains = false;

	constructor(app, opts) {
		this.app = app;
		this.#domains = opts ?? [];
		if (this.#domains.length == 0) {
			console.warn("'domains' configuration variable is empty, using default localhost.localdomain");
			this.#domains.push('localhost.localdomain');
		}

		if (app.version != app.opts.upstream) {
			this.#wait.resolve();
		}
	}

	init() {
		this.wk = {
			cache: this.app.opts.cache.wkp,
			status: "/.well-known/status",
			proxy: "/.well-known/pageboard"
		};
	}

	siteRoutes(router) {
		router.use((req, res, next) => {
			this.extendRequest(req, res, this.app);
			next();
		});
		router.get(this.wk.proxy, async (req, res, next) => {
			const domains = await this.#allDomains(req);
			this.#wait.resolve();
			res.json(domains);
		});
		router.use(async (req, res, next) => {
			await this.#wait;
			if (!this.#allDomainsCalled) {
				await this.#allDomains(req);
			}
			await this.#initRecord(req.headers['x-forwarded-by']);
			const obj = await this.#initRequest(req, res);
			if (obj) {
				res.json(obj);
			} else {
				next();
			}
		});
	}

	#initRecord(ip) {
		if (!ip) {
			throw new HttpError.BadRequest("Wrong proxy headers");
		}
		const rec = this.#ips[ip] || {};
		if (!rec.initializer) {
			this.#ips[ip] = rec;
			rec.initializer = dns.reverse(ip).then(hostnames => {
				Object.assign(rec, ipFamily(ip));
				hostnames.forEach(hn => {
					if (hn == "localhost") hn += ".localdomain";
					hn = '.' + hn;
					if (!this.#suffixes.includes(hn)) this.#suffixes.push(hn);
				});
				const idMap = {};
				for (const [id, site] of Object.entries(this.#siteById)) {
					for (const domain of castArray(site.data.domains)) {
						idMap[domain] = id;
					}
				}
				for (const id of Object.keys(this.#siteById)) {
					for (const suffix of this.#suffixes) {
						const domain = `${id}${suffix}`;
						if (!idMap[domain]) {
							// only if no domain already have that one
							idMap[domain] = id;
						}
					}
				}
				this.#idByDomain = idMap;
			});
		}
		return rec.initializer;
	}

	async #initRequest(req, res) {
		this.#initTenant(req);
		const { path } = req;
		const { app, wk } = this;
		const { host, site } = this.#initHost(req);

		if (host.state == INIT) {
			host.state = BUSY;
			try {
				host.hold();
				await this.#resolvableHost(req.$url.hostname, host);
				req.site = site;
				await req.run('core.build', site);
				host.state = READY;
				host.release();
			} catch (err) {
				console.error(err);
				this.error(req, err);
			}
		}
		const isPost = req.method == "POST";
		if (path == wk.status && !isPost) {
			if (host.state != READY && host.state != PARKED) {
				throw new HttpError.ServiceUnavailable("Site is not ready");
			} else {
				return {
					errors: host.errors
				};
			}
		} else {
			await host.wait();
			if (host.state == PARKED) {
				throw new HttpError.ServiceUnavailable("Site is parked");
			}
			req.site = await this.#initSite(host, req, res);

			const version = site.data.server || app.version;
			if (version != app.version) {
				res.set('X-Pageboard-Peer', app.opts.upstreams[version]);
				if (req.method == "GET") {
					res.redirect(307, req.url);
				}
			}
		}
	}

	extendRequest(req, res, app) {
		req.opts = app.opts;
		req.res = res;
		res.locals ??= {};
		res.accelerate = path => {
			res.set('X-Accel-Redirect', "/@internal" + path);
			res.end();
		};
		req.call = (command, data) => {
			const [mod, name] = command.split('.');
			return app[mod][name](req, data);
		};
		req.run = (command, data) => {
			return app.api.run(req, command, data);
		};
		req.filter = data => {
			return app.api.filter(req, data);
		};

		req.types = new Set();

		req.locked = list => app.auth.locked(req, list);
		req.tag = (...args) => app.cache.tag(...args)(req, req.res);

		if (!req.get) req.get = str => {
			console.info("Cannot use req.get in cli mode");
			return null;
		};

		req.try = async (block, job, opts = {}) => {
			const response = block.data.response ??= { count: 0 };
			const start = performance.now();
			response.status = null;
			response.text = null;
			try {
				const result = await job(req, block);
				response.status = 200;
				response.text = 'OK';
				if (opts.count) response.count = (response.count ?? 0) + 1;
				return result;
			} catch (ex) {
				response.status = ex.statusCode ?? 500;
				response.text = ex.message ?? null;
				console.error(ex);
				throw ex;
			} finally {
				response.time = performance.now() - start;
				try {
					await req.run('block.save', {
						id: block.id,
						type: block.type,
						data: block.data
					});
				} catch (err) {
					console.error("Cannot save job response", block.id, response);
					console.error(err);
				}
			}
		};
		req.finitions = [];
		req.finish = fn => {
			req.finitions.push(fn);
		};
	}

	async #initSite(host, req, res) {
		const origSite = this.#siteById[host.id];
		const site = origSite.$clone();
		const { tenant } = res.locals;
		if (tenant) {
			if (!host.tenants[tenant]) {
				const tsite = await req.run('site.get', { id: host.id });
				host.tenants[tenant] = tsite._id;
			}
			site._id = host.tenants[tenant];
			req.$url.hostname = req.hostname;
			site.data = {
				...site.data,
				env: 'dev',
				domains: []
			};
		} else if (req.path) {
			const domains = castArray(site.data.domains);
			if (domains.length && req.hostname != domains[0] && !req.path.startsWith('/@')) {
				const { host } = this.#initHost(req, domains[0]);
				await host.wait();
				req.tag('data-:site');
				res.redirect(308, req.$url.href + req.url);
			}
		}
		res.locals.site = site.id;
		return site;
	}

	async #allDomains(req) {
		const list = await req.run('site.all');
		const domains = {};
		const siteMap = {};
		const hostMap = {};
		for (const site of list) {
			this.#domainMapping(domains, site);
			const cur = siteMap[site.id] = this.#siteById[site.id];
			if (cur) {
				Object.assign(cur, site);
			} else {
				siteMap[site.id] = site;
			}

			const host = hostMap[site.id] = this.#hostById[site.id];
			if (!host) hostMap[site.id] = new Host(site.id);
		}
		this.#siteById = siteMap;
		this.#hostById = hostMap;
		this.#allDomainsCalled = true;

		return { domains };
	}

	#domainMapping(map, site) {
		const version = site.data.server || this.app.version;
		const upstream = this.app.opts.upstreams[version];
		const domains = [...castArray(site.data.domains)];
		if (domains.length == 0) {
			if (process.env.NODE_ENV != "production") {
				domains.unshift(site.id + "." + this.#domains[0]);
			} else {
				// because conflicts cannot be managed here
				if (!this.#hasLoggedMissingDomains) {
					console.warn("Ignoring site without domains:", site.id);
					this.#hasLoggedMissingDomains = true;
				}
				return map;
			}
		}
		const primary = domains.shift();
		for (const secondary of [...domains]) {
			if (map[secondary]) {
				console.error("Secondary domain already declared", site.id, secondary);
			} else {
				map[secondary] = '=' + primary;
			}
		}
		if (map[primary] == null) {
			map[primary] = upstream;
		} else {
			console.error("Primary domain already declared", site.id, primary);
		}
		return map;
	}

	#initTenant(req) {
		const {
			groups: { tenant, domain }
		} = /^(?:(?<tenant>[a-z0-9]+)-)?(?<id>[a-z0-9]+)(?<domain>\.[a-z0-9]+\.[a-z]+)$/.exec(req.hostname) || { groups: {} };

		if (tenant && this.#suffixes.includes(domain) && tenant in this.app.opts.database.url) {
			req.res.locals.tenant = tenant;
		}
	}

	#initHost(req, hostname = req.hostname) {
		const origHost = ((t, h) => {
			if (!t) return h;
			else if (h.startsWith(`${t}-`)) return h.substring(t.length + 1);
		})(req.res.locals.tenant, hostname);
		const id = this.#idByDomain[origHost];
		if (!id) {
			throw new HttpError.NotFound("domain not found");
		}
		const site = this.#siteById[id];
		if (!site) {
			throw new HttpError.NotFound("site not found");
		}
		const host = this.#hostById[id];
		host.by = req.headers['x-forwarded-by'];

		req.$url = new URL("http://a.a");
		req.$url.protocol = req.protocol;
		req.$url.hostname = castArray(site.data.domains)[0] || hostname;
		req.$url.port = portFromHost(req.host);
		return { host, site };
	}

	async #resolvableHost(hostname, host) {
		const rec = this.#ips[host.by];
		const lookup = await dns.lookup(hostname, {
			family: 4
		});
		if (lookup.address == hostname) {
			throw new Error("hostname is an ip " + hostname);
		}
		const expected = rec['ip' + lookup.family];

		if (lookup.address != expected) {
			setTimeout(() => {
				// allow checking again in a minute
				host.reset();
			}, 60000);
			console.error(Text`${hostname} ${lookup.family} ${lookup.address}
				does not match ${expected}`);
			throw new HttpError.ServiceUnavailable('Host unknown');
		}
	}

	hold(req, site) {
		this.#hostById[site.id]?.hold();
	}

	release(req, site) {
		const host = this.#hostById[site.id];
		if (host) {
			this.#idByDomainUpdate(req, site);
			this.#siteById[site.id] = site;
			host.errors = [];
			host.release();
		}
		return site;
	}

	site(id, site) {
		if (site) {
			this.#siteById[id] = site;
			return site;
		} else {
			return this.#siteById[id];
		}
	}

	#idByDomainUpdate(req, site) {
		const id = site.id;
		for (const domain of castArray(req.site?.data.domains)) {
			this.#idByDomain[domain] = null;
		}
		for (const domain of castArray(site.data.domains)) {
			this.#idByDomain[domain] = id;
		}
		for (const suffix of this.#suffixes) {
			this.#idByDomain[`${id}${suffix}`] = id;
		}
	}

	error(req, err) {
		const host = req.site?.id ? this.#hostById[req.site.id] : null;
		if (!host) {
			console.error("Error", req.site?.id, err);
			return;
		}
		if (!host.errors) host.errors = [];
		host.errors.push(errorObject(err));
		host.state = PARKED;
		host.release();
	}
};

function errorObject(err) {
	const std = err.toString();
	const errObj = {
		name: err.name,
		message: err.message
	};
	if (err.stack) errObj.stack = err.stack.split('\n').map(line => {
		if (line == std) return;
		const index = line.indexOf("/pageboard/");
		if (index >= 0) return line.substring(index);
		if (/^\s*at\s/.test(line)) return;
		return line;
	}).filter(x => Boolean(x)).join('\n');

	return errObj;
}

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}

function ipFamily(ip) {
	const fam = isIPv6(ip) ? 6 : 4;
	const ips = {};
	ips['ip' + fam] = ip;
	const prefix = '::ffff:';
	if (fam == 6) {
		if (ip.startsWith(prefix)) {
			const tryFour = ip.substring(prefix.length);
			if (!isIPv6(tryFour)) {
				ips.ip4 = tryFour;
				ip = tryFour;
			}
		}
	}
	return ips;
}

function portFromHost(host) {
	const parts = host.split(':');
	const port = parts.length == 2 ? parseInt(parts[1]) : null;
	if (!Number.isNaN(port)) return port;
	else return null;
}

function castArray(prop) {
	if (prop == null) return [];
	if (typeof prop == "string") return [prop];
	if (Array.isArray(prop)) return prop;
	else throw new Error("Cannot castArray " + typeof prop);
}
