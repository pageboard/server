const { promises: dns, setDefaultResultOrder } = require('node:dns');
const { performance } = require('node:perf_hooks');
const { Deferred } = require('class-deferred');
const OnHeaders = require('on-headers');

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

module.exports = class Domains {
	#wait = new Deferred();
	#ips = {};
	#suffixes = [];
	#allDomainsCalled = false;
	idByDomain = {};
	hostById = {};
	siteById = {};

	constructor(app, opts) {
		this.app = app;
		this.wk = {
			cache: opts.cache.wkp,
			git: opts.git.wkp,
			status: "/.well-known/status",
			proxy: "/.well-known/pageboard"
		};
		if (app.version != opts.upstream) {
			this.#wait.resolve();
		}
	}

	routes(app, server) {
		server.use(req => {
			this.extendRequest(req, app);
		});
		server.use(this.wk.proxy, async req => {
			const domains = await this.#allDomains(req);
			this.#wait.resolve();
			return domains;
		});
		server.use(async (req, res) => {
			await this.#wait;
			if (!this.#allDomainsCalled) {
				await this.#allDomains(req);
			}
			await this.#initRecord(req.headers['x-forwarded-by']);
			return this.#initRequest(req, res);
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
				for (const [id, site] of Object.entries(this.siteById)) {
					for (const domain of castArray(site.data.domains)) {
						idMap[domain] = id;
					}
				}
				for (const id of Object.keys(this.siteById)) {
					for (const suffix of this.#suffixes) {
						const domain = `${id}${suffix}`;
						if (!idMap[domain]) {
							// only if no domain already have that one
							idMap[domain] = id;
						}
					}
				}
				this.idByDomain = idMap;
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
				await this.#resolvableHost(site.$url.hostname, host);
				await req.run('install.domain', site);
				host.state = READY;
				host.release();
			} catch (err) {
				this.error(site, err);
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
			await this.#initSite(host, req, res);

			const version = site.data.server || app.version;
			if (version != app.version) {
				res.set('X-Pageboard-Peer', app.opts.upstreams[version]);
				if (req.method == "GET") {
					res.redirect(307, req.url);
				}
			}
		}
	}

	extendRequest(req, app) {
		req.opts = app.opts;
		const { res } = req;
		if (!res.locals) res.locals = {};
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

		req.types = new Set();

		req.locked = list => app.auth.locked(req, list);
		req.tag = (...args) => app.cache.tag(...args)(req, req.res);

		if (!req.get) req.get = str => {
			console.info("Cannot use req.get in cli mode");
			return null;
		};

		req.try = async (block, job) => {
			const { response } = block.data;
			const start = performance.now();
			response.status = null;
			response.text = null;
			try {
				const result = await job(req, block);
				response.status = 200;
				response.text = 'OK';
				return result;
			} catch (ex) {
				response.status = ex.statusCode ?? 500;
				response.text = ex.message ?? null;
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
		OnHeaders(req.res, () => {
			while (req.finitions.length) req.finitions.shift()(req);
		});
		req.finitions = [];
		req.finish = fn => {
			req.finitions.push(fn);
		};
		req.postTries = [];
		req.postTry = (block, job) => {
			if (req.postTries.length == 0) req.finish(postTryProcess);
			req.postTries.push([block, job]);
		};
	}

	async #initSite(host, req, res) {
		const origSite = this.siteById[host.id];
		const site = origSite.$clone();
		site.$url = new URL(origSite.$url);
		const { tenant } = res.locals;
		if (tenant) {
			if (!host.tenants[tenant]) {
				const tsite = await req.run('site.get', { id: host.id });
				host.tenants[tenant] = tsite._id;
			}
			site._id = host.tenants[tenant];
			site.$url.hostname = req.hostname;
			site.data = {
				...site.data,
				env: 'dev',
				domains: []
			};
		} else if (req.path !== this.wk.git) {
			const domains = castArray(site.data.domains);
			if (domains.length && req.hostname != domains[0] && !req.path.startsWith('/@')) {
				Object.defineProperty(req, 'hostname', {
					value: domains[0]
				});
				const { host } = this.#initHost(req);
				await host.wait();
				req.tag('data-:site');
				res.redirect(308, site.$url.href + req.url);
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
			this.#domainMapping(domains, site);
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
		this.#allDomainsCalled = true;

		return { domains };
	}

	#domainMapping(map, site) {
		const version = site.data.server || this.app.version;
		const upstream = this.app.opts.upstreams[version];
		const domains = [ ...castArray(site.data.domains) ];
		const domain = domains.shift();
		if (domain != null) {
			for (const secondary of [...domains, site.id]) {
				if (map[secondary]) {
					console.error("Seconday domain already declared", site.id, secondary);
				} else {
					map[secondary] = '=' + domain;
				}
			}
			if (map[domain] == null) {
				map[domain] = upstream;
			}
		}
		// the proxy tries the full domain first, and then the prefix
		map[site.id] = upstream;
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

		site.$url = new URL("http://a.a");
		site.$url.protocol = req.protocol;
		site.$url.hostname = castArray(site.data.domains)[0] || req.hostname;
		site.$url.port = portFromHost(req.headers.host);
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

	hold(site) {
		this.hostById[site.id]?.hold();
	}

	release(site) {
		const host = this.hostById[site.id];
		if (!host) return;

		if (!site.data.domains) site.data.domains = [];
		const old = this.siteById[site.id];
		site.$url ??= old?.$url;
		this.#idByDomainUpdate(site, old);
		this.siteById[site.id] = site;
		host.errors = [];
		host.release();
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

async function postTryProcess(req) {
	const { postTries: list } = req;
	if (!list.length) return;
	req.postTries = [];
	while (list.length) {
		req.trx = await req.genTrx();
		try {
			await req.try(...list.shift());
		} catch (ex) {
			console.error(ex);
			// stop there
			list.splice(0, list.length);
		} finally {
			if (!req.trx.isCompleted()) {
				await req.trx.commit();
			}
		}
	}
}
