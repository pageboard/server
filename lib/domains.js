const dns = require('dns').promises;
const { Deferred } = require('./utils');
const Queue = require('./express-queue');

const localhost4 = "127.0.0.1";
// const localhost6 = "::1";

const [
	INIT,
	BUSY,
	READY,
	PARKED
] = Array.from({ length: 4 }, (_, i) => Symbol(i));



class Host {
	tenants = {};
	queue;
	state;

	constructor(id) {
		this.id = id;
		this.reset();
	}
	reset() {
		this.state = INIT;
		this.queue = new Queue(() => {
			this.state = READY;
		});
	}
}

module.exports = class Domains {
	#wait = new Deferred(() => {
		this.#state = READY;
	});
	#ips = {};
	#suffixes = [];
	idByDomain = {};
	hostById = {};
	siteById = {};
	#state = INIT;

	constructor(app, opts) {
		this.app = app;
		this.wk = {
			cache: opts.cache.wkp,
			status: "/.well-known/status",
			proxy: "/.well-known/pageboard"
		};
	}

	routes(app, server) {
		server.use(req => {
			this.extendRequest(req, app);
		});
		server.use(this.wk.proxy, async req => {
			const ret = await this.#allDomains(req);
			if (this.#state != READY) {
				this.#wait.resolve();
			}
			return ret;
		});
		server.use(async (req, res) => {
			await this.#wait;
			await this.#initRecord(req.headers['x-forwarded-by']);
			return this.#initRequest(req, res);
		});
	}

	#initRecord(ip) {
		if (!ip) {
			new HttpError.BadRequest("Wrong proxy headers");
		}
		const rec = this.#ips[ip] || {};
		if (!rec.queue) {
			this.#ips[ip] = rec;
			rec.queue = dns.reverse(ip).then(hostnames => {
				Object.assign(rec, ipFamily(ip));
				hostnames.forEach(hn => {
					if (hn == "localhost") hn += ".localdomain";
					hn = '.' + hn;
					if (!this.#suffixes.includes(hn)) this.#suffixes.push(hn);
				});
				const idMap = {};
				for (const id in this.siteById) {
					const site = this.siteById[id];
					for (const domain of castArray(site.data.domains)) {
						idMap[domain] = id;
					}
					for (const suffix of this.#suffixes) {
						idMap[`${id}${suffix}`] = id;
					}
				}
				this.idByDomain = idMap;
			});
		}
		return rec.queue;
	}

	async #initRequest(req, res) {
		this.#initTenant(req);
		const { path } = req;
		const { app, wk } = this;
		const { host, site } = this.#initHost(req);

		if (host.state == INIT) {
			host.state = BUSY;
			host.queue.push(() => {
				return this.#resolvableHost(site.url.hostname, host);
			});
			host.queue.push(() => {
				return app.install(site);
			});
			host.upcache = new Deferred();
			host.queue.push(() => {
				return host.upcache;
			});
		}
		if (path == wk.cache) {
			if (host.upcache) {
				host.upcache.resolve();
			}
			return null; // 204
		} else if (path == wk.status) {
			if (host.state != READY && host.state != PARKED) {
				throw new HttpError.ServiceUnavailable("Site is not ready");
			} else {
				return {
					errors: host.errors
				};
			}
		}
		await host.queue.idle();
		if (host.state == PARKED) {
			throw new HttpError.ServiceUnavailable("Site is parked");
		}

		await this.#initSite(host, req, res);

		const version = site.data.server || app.version;
		if (version != app.version) {
			res.set('X-Pageboard-Peer', app.opts.upstreams[version]);
			if (req.method == "GET") {
				res.redirect(307, req.url);
			}
		}
	}

	extendRequest(req, app) {
		req.opts = app.opts;
		const { res } = req;
		req.call = (command, data) => {
			const [mod, name] = command.split('.');
			return app[mod][name](req, data);
		};
		req.run = (command, data) => {
			return app.run(req, command, data);
		};

		req.locked = (list) => app.auth.locked(req, list);
		req.tag = (...args) => app.cache.tag(...args)(req, res);

		res.return = (data) => {
			app.send(res, data);
		};
	}

	async #initSite(host, req, res) {
		const origSite = this.siteById[host.id];
		const site = origSite.$clone();
		site.url = new URL(origSite.url);
		const { tenant } = res.locals;
		if (tenant) {
			if (!host.tenants[tenant]) {
				const tsite = await req.run('site.get', { id: host.id });
				host.tenants[tenant] = tsite._id;
			}
			site._id = host.tenants[tenant];
			site.url.hostname = req.hostname;
			site.data = Object.assign({}, site.data, {
				env: 'dev',
				domains: []
			});
		} else {
			const domains = castArray(site.data.domains);
			if (domains.length && req.hostname != domains[0] && !req.path.startsWith('/.')) {
				Object.defineProperty(req, 'hostname', {
					value: domains[0]
				});
				const rhost = this.#initHost(req);
				await rhost.queue.idle();
				req.tag('data-:site');
				res.redirect(308, site.url.href + req.url);
			}
		}
		req.site = site;
		res.locals.site = site.id;
	}

	async #allDomains(req) {
		const list = await req.run('site.all');
		const domains = {};
		const siteMap = {};
		const hostMap = {};
		for (const site of list) {
			Object.assign(domains, this.#domainMapping(site));
			const cur = siteMap[site.id] = this.siteById[site.id];
			if (cur) {
				Object.assign(cur, site);
			} else {
				siteMap[site.id] = site;
			}

			const host = hostMap[site.id] = this.hostById[site.id];
			if (!host) hostMap[site.id] = new Host(site.id);
		}
		this.siteById = siteMap;
		this.hostById = hostMap;

		return { domains };
	}

	#domainMapping(site) {
		const map = {};
		const version = site.data.server || this.app.version;
		const upstream = this.app.opts.upstreams[version];
		const domains = castArray(site.data.domains).slice();
		const domain = domains.shift();
		if (domain != null) {
			for (const secondary of domains.concat([site.id])) {
				map[secondary] = '=' + domain;
			}
			map[domain] = upstream;
		} else {
			map[site.id] = upstream;
		}
		return map;
	}

	#initTenant(req) {
		const {
			groups: { tenant, domain }
		} = /^(?:(?<tenant>[a-z0-9]+)-)?(?<id>[a-z0-9]+)(?<domain>\.[a-z0-9]+\.[a-z]+)$/.exec(req.hostname) || { groups: {} };

		if (tenant && this.suffixes.includes(domain) && tenant in this.app.opts.database.url) {
			req.res.locals.tenant = tenant;
		}
	}

	#initHost(req) {
		const origHost = ((t, h) => {
			if (!t) return h;
			else if (h.startsWith(`${t}-`)) return h.substring(t.length + 1);
		})(req.res.locals.tenant, req.hostname);
		const id = this.idByDomain[origHost];
		if (!id) {
			throw new HttpError.NotFound("domain not found");
		}
		const site = this.siteById[id];
		if (!site) {
			throw new HttpError.NotFound("site not found");
		}
		const host = this.hostById[id];
		host.by = req.headers['x-forwarded-by'];

		site.url = new URL("http://a.a");
		site.url.protocol = req.protocol;
		site.url.hostname = castArray(site.data.domains)[0] || req.hostname;
		site.url.port = portFromHost(req.headers.host);
		return { host, site };
	}

	async #resolvableHost(hostname, host) {
		const rec = this.#ips[host.by];
		const lookup = await dns.lookup(hostname, {
			all: false
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
			throw new HttpError.ServiceUnavailable(
				Text`${hostname} ${lookup.family} ${lookup.address}
				does not match ${expected}`
			);
		}
	}

	hold(site) {
		if (site.data.env == "production" && site.$model) {
			// installed site in production
			return;
		}
		const host = this.hostById[site.id];
		if (!host) return;
		host.queue.hold();
	}

	release(site) {
		const host = this.hostById[site.id];
		if (!host) return;

		if (!site.data.domains) site.data.domains = [];
		this.#idByDomainUpdate(site, this.siteById[site.id]);
		this.siteById[site.id] = site;

		host.queue.release();
	}

	#idByDomainUpdate(site, old) {
		const id = site.id;
		if (old) {
			for (const domain of castArray(old.data.domains)) {
				this.idByDomain[domain] = null;
			}
		}
		for (const domain of castArray(site.data.domains)) {
			this.idByDomain[domain] = id;
		}
		for (const suffix of this.#suffixes) {
			this.idByDomain[`${id}${suffix}`] = id;
		}
	}

	error(site, err) {
		const host = this.hostById[site.id];
		if (!host) {
			console.error("Error", site.id, err);
			return;
		}
		if (!host.errors) host.errors = [];
		host.errors.push(errorObject(err));
		if (site.data.env == "production" && site.$model) {
			// do nothing
		} else {
			host.state = PARKED;
		}
	}
};

function errorObject(err) {
	const std = err.toString();
	const errObj = {
		name: err.name,
		message: err.message
	};
	if (err.stack) errObj.stack = err.stack.split('\n').map((line) => {
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
