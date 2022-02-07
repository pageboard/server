const dns = require('dns').promises;
const Deferred = require('./deferred');

const localhost4 = "127.0.0.1";
// const localhost6 = "::1";

class Host {
	constructor(id) {
		this.id = id;
		this.tenants = {};
	}
}

module.exports = class Domains {
	constructor(All) {
		this.All = All;
		this.opt = All.opt;

		this.ips = {};
		this.suffixes = [];

		this.idByDomain = {};
		this.hostById = {};
		this.siteById = {};

		this.wait = new Deferred(() => {
			this.ready = true;
		});

		this.middlewares = [
			(req, res, next) => {
				this.byInit(req, res, next);
			},
			(req, res, next) => {
				this.byIP(req, res, next);
			},
			(req, res, next) => {
				this.byHost(req, res, next);
			}
		];
	}

	async byInit(req, res, next) {
		if (req.path == "/.well-known/pageboard" && req.hostname == localhost4) {
			this.syncSites(req, res, next);
		} else if (!this.ready) {
			await this.wait;
			next();
		} else {
			next();
		}
	}

	async byIP(req, res, next) {
		const ip = req.headers['x-forwarded-by'];
		if (!ip) {
			next(new HttpError.BadRequest("Wrong proxy headers"));
			return;
		}

		const rec = this.ips[ip] || {};
		if (!rec.queue) {
			this.ips[ip] = rec;
			rec.queue = dns.reverse(ip).then((hostnames) => {
				Object.assign(rec, ipFamily(ip));
				hostnames.forEach((hn) => {
					if (hn == "localhost") hn += ".localdomain";
					hn = '.' + hn;
					if (!this.suffixes.includes(hn)) this.suffixes.push(hn);
				});
				const idMap = {};
				for (const id in this.siteById) {
					const site = this.siteById[id];
					for (const domain of castArray(site.data.domains)) {
						idMap[domain] = id;
					}
					for (const suffix of this.suffixes) {
						idMap[`${id}${suffix}`] = id;
					}
				}
				this.idByDomain = idMap;
			});
		}
		await rec.queue;
		next();
	}

	async byHost(req, res, next) {
		this.initTenant(req);
		const { path } = req;
		const host = this.init(req);
		if (!host) return next(new HttpError.NotFound("site not found"));
		let p;
		if (path == "/.well-known/upcache") {
			if (host.finalize) {
				host.finalize();
			}
			p = host.installing;
		} else if (path == "/.well-known/status" || path == "/.well-known/pageboard") {
			if (req.accepts('json')) p = host.waiting;
			else p = host.searching;
		} else if (path == "/favicon.ico" || path.startsWith('/.files/') || path.startsWith('/.api/')) {
			p = host.waiting;
		} else if (host.isWaiting) {
			p = new Deferred();
			setTimeout(p.resolve, host.parked ? 0 : 2000);
			await p;
			if (host.isWaiting && !req.path.startsWith('/.') && this.opt.env != "development") {
				next = null;
				res.type('html').sendStatus(503);
			} else {
				p = host.waiting;
			}
		} else {
			p = host.waiting;
		}
		await p;
		if (!next) return;
		if (host.error) throw host.error;
		const origSite = this.siteById[host.id];
		const site = origSite.$clone();
		site.errors = origSite.errors;
		site.url = new URL(origSite.url);
		const { tenant } = res.locals;
		if (tenant) {
			if (!host.tenants[tenant]) {
				const tsite = await All.run('site.get', req, { id: host.id });
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
				const rhost = this.init(req);
				await rhost.waiting;
				this.All.cache.tag('data-:site')(req, res, () => {
					res.redirect(308, site.url.href + req.url);
				});
			}
		}
		req.site = site;
		res.locals.site = site.id;
		if (path == "/.well-known/status" || path == "/.well-known/pageboard") {
			// /.well-known/pageboard is kept during transition
			// this is expected by proxy/statics/status.html
			res.send({
				errors: site.errors
			});
		} else {
			const version = site.data.server || this.opt.version;
			if (version != this.opt.version) {
				res.set('X-Pageboard-Peer', this.opt.upstreams[version]);
				if (req.method == "GET") res.redirect(307, req.url);
				else next();
			} else {
				next();
			}
		}
	}

	async syncSites(req, res) {
		const list = await this.All.run('site.all', req);
		const map = {};
		const siteMap = {};
		const hostMap = {};
		for (const site of list) {
			Object.assign(map, this.domainMapping(site));
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

		res.type('json').end(JSON.stringify({
			domains: map
		}, null, ' '));

		if (!this.ready) setTimeout(() => {
			this.wait.resolve();
		}, 1000);
	}

	domainMapping(site) {
		const map = {};
		const version = site.data.server || this.opt.version;
		const upstream = this.opt.upstreams[version];
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

	initTenant(req) {
		const {
			groups: { tenant, domain }
		} = /^(?:(?<tenant>[a-z0-9]+)-)?(?<id>[a-z0-9]+)(?<domain>\.[a-z0-9]+\.[a-z]+)$/.exec(req.hostname) || { groups: {} };

		if (tenant && this.suffixes.includes(domain) && tenant in this.opt.database.url) {
			req.res.locals.tenant = tenant;
		}
	}

	async init(req) {
		const origHost = ((t, h) => {
			if (!t) return h;
			else if (h.startsWith(t + '-')) return h.substring(t.length + 1);
		})(req.res.locals.tenant, req.hostname);
		const id = this.idByDomain[origHost];
		if (!id) return null;
		const site = this.siteById[id];
		if (!site) return null;
		const host = this.hostById[id];
		host.by = req.headers['x-forwarded-by'];

		site.url = new URL("http://a.a");
		site.url.protocol = req.protocol;
		site.url.hostname = castArray(site.data.domains)[0] || req.hostname;
		site.url.port = portFromHost(req.headers.host);

		if (!host.searching && !host.error) {
			try {
				host.searching = await this.resolvableHost(site.url.hostname, host);
			} catch (err) {
				host.error = err;
				if (host.finalize) host.finalize();
			}
		}

		if (!host.installing && !host.error) {
			host.installing = await host.searching;
			if (host.error) return;
			try {
				await this.All.install(site);
			} catch (err) {
				// never throw an error since errors are already dealt with in install
			}
		}
		if (!host.waiting && !host.error) {
			doWait(host);
		}
		return host;
	}

	async resolvableHost(hostname, host) {
		const rec = this.ips[host.by];
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
				if (host.error && host.error.statusCode == 503) delete host.error;
			}, 60000);
			throw new HttpError.ServiceUnavailable(
				Text`${hostname} ${lookup.family} ${lookup.address}
				does not match ${expected}`
			);
		}
	}

	hold(site) {
		if (site.data.env == "production" && site.$model) return; // do not hold
		const host = this.hostById[site.id];
		if (!host) return;
		doWait(host);
	}

	release(site) {
		const host = this.hostById[site.id];
		if (!host) return;

		if (!site.data.domains) site.data.domains = [];
		this.idByDomainUpdate(site, this.siteById[site.id]);
		this.siteById[site.id] = site;

		host.isWaiting = false;
		delete host.parked;
	}

	idByDomainUpdate(site, old) {
		const id = site.id;
		if (old) {
			for (const domain of castArray(old.data.domains)) {
				this.idByDomain[domain] = null;
			}
		}
		for (const domain of castArray(site.data.domains)) {
			this.idByDomain[domain] = id;
		}
		for (const suffix of this.suffixes) {
			this.idByDomain[`${id}${suffix}`] = id;
		}
	}

	error(site, err) {
		try {
			if (!site.url) {
				console.warn("All.domains.error(site) missing site.url");
			}
			const host = this.hostById[site.id];
			if (!host) {
				console.error("Error", site.id, err);
				return;
			}
			if (!site.errors) site.errors = [];
			site.errors.push(errorObject(site, err));
			if (site.data.env == "production" && site.$model) {
				// do nothing
			} else {
				host.isWaiting = true;
				host.parked = true;
			}
			if (host.finalize) host.finalize();
		} catch (ex) {
			console.error(ex);
		}
	}
};

function errorObject(site, err) {
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

async function doWait(host) {
	if (host.finalize) return;
	host.isWaiting = true;
	const subpending = new Promise((resolve) => {
		host.finalize = function() {
			delete host.finalize;
			resolve();
		};
	});
	host.waiting = await host.installing;
	return subpending;
}

function castArray(prop) {
	if (prop == null) return [];
	if (typeof prop == "string") return [prop];
	if (Array.isArray(prop)) return prop;
	else throw new Error("Cannot castArray " + typeof prop);
}

