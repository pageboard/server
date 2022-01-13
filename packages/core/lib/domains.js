const DNS = {
	lookup: require('util').promisify(require('dns').lookup),
	reverse: require('util').promisify(require('dns').reverse)
};
const Hosts = require('./hosts');

const localhost4 = "127.0.0.1";
// const localhost6 = "::1";

module.exports = class Domains {
	constructor(All) {
		this.All = All;
		this.opt = All.opt;
		this.sites = {}; // cache sites by id
		this.hosts = new Hosts();
		this.state = {
			ready: false,
			done: () => {
				this.state.ready = true;
				this.state.resolve();
			}
		};
		this.state.wait = new Promise((resolve) => {
			this.state.resolve = resolve;
		});
		this.ips = {};
		this.names = [];
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
	/*
maintain a cache (hosts) of requested hostnames
- each hostname is checked to resolve to pageboard current IP (which is resolved and cached,
so adding an IP to pageboard and pointing a host to that IP needs a restart)
- then each hostname, if it is a subdomain of pageboard, gives a site.id, or if not, a site.domain
- site instance is loaded and cached
- /.well-known/status returns here
- site is installed and init() is holded by a hanging promise
- site installation calls upcache update url, which resolves the hanging promise
- init returns for everyone
*/
	byInit(req, res, next) {
		if (req.path == "/.well-known/pageboard" && req.hostname == localhost4) {
			this.wkp(req, res, next);
		} else if (!this.state.ready) {
			this.state.wait.then(next);
		} else {
			next();
		}
	}
	byIP(req, res, next) {
		const ip = req.headers['x-forwarded-by'];
		if (!ip) return next(new Error("Missing X-Forwarded-By header"));
		const rec = this.ips[ip] || {};
		if (!rec.queue) {
			this.ips[ip] = rec;
			rec.queue = DNS.reverse(ip).then((hostnames) => {
				Object.assign(rec, ipFamily(ip));
				hostnames.forEach((hn) => {
					if (hn == "localhost") hn += ".localdomain";
					hn = '.' + hn;
					if (!this.names.includes(hn)) this.names.push(hn);
				});
			});
		}
		rec.queue.then(next);
	}
	byHost(req, res, next) {
		const { path } = req;
		const host = this.init(req);
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
			p = new Promise((resolve) => {
				setTimeout(resolve, host.parked ? 0 : 2000);
			}).then(() => {
				if (host.isWaiting && !req.path.startsWith('/.') && this.opt.env != "development") {
					next = null;
					res.type('html').sendStatus(503);
				} else {
					return host.waiting;
				}
			});
		} else {
			p = host.waiting;
		}
		return p.then(() => {
			if (!next) return;
			if (host.error) throw host.error;
			const site = this.sites[host.id];
			if (!host.id || !site) {
				// this should never actually happen !
				throw new HttpError.ServiceUnavailable(`Missing host.id or site for ${host.name}`);
			}
			// calls to api use All.run which does site.$clone() to avoid concurrency issues
			req.site = site;
			return site;
		}).then((site) => {
			if (!next) return;
			if (req.hostname != host.domains[0] && !req.path.startsWith('/.')) {
				req.hostname = host.domains[0];
				const rhost = this.init(req);
				rhost.waiting.then(() => {
					this.All.cache.tag('data-:site')(req, res, () => {
						res.redirect(308, rhost.href + req.url);
					});
				});
				return site;
			} else {
				return site;
			}
		}).then((site) => {
			if (!next) return;
			// this sets the site hostname, shared amongst all sites
			site.href = host.href;
			site.hostname = host.name; // at this point it should be == host.domains[0]

			if (path == "/.well-known/status" || path == "/.well-known/pageboard") {
				// /.well-known/pageboard is kept during transition
				// this is expected by proxy/statics/status.html
				res.send({
					errors: site.errors
				});
			} else {
				const version = site.server || site.data.server || this.opt.version;
				if (version != this.opt.version) {
					res.set('X-Pageboard-Peer', this.opt.upstreams[version]);
					if (req.method == "GET") res.redirect(307, req.url);
					else next();
				} else {
					next();
				}
			}
		}).catch(next);
	}

	wkp(req, res, next) {
		this.All.run('site.all', req).then((list) => {
			const map = {};
			list.forEach((site) => {
				Object.assign(map, this.domainMapping(site));
			});
			res.type('json').end(JSON.stringify({
				domains: map
			}, null, ' '));

			if (!this.state.ready) setTimeout(() => {
				this.state.done();
			}, 1000);
		}).catch(next);
	}

	domainMapping(site) {
		const map = {};
		const rsite = this.sites[site.id];
		const version = rsite && rsite.server || site.data.server || this.opt.version;
		const upstream = this.opt.upstreams[version];
		let domains = site.data.domains;
		if (!domains) domains = [];
		else if (typeof domains == "string") domains = [domains];
		const domain = domains.shift();
		if (domain != null) {
			domains = domains.slice();
			domains.push(site.id);
			domains.forEach((secondary) => {
				map[secondary] = '=' + domain;
			});
			map[domain] = upstream;
		} else {
			map[site.id] = upstream;
		}
		return map;
	}

	init(req) {
		const sites = this.sites;
		const host = this.hosts.provision(req);

		if (!host.searching && !host.error) {
			host.searching = Promise.resolve().then(() => {
				return this.resolvableHost(host);
			}).then(() => {
				this.normalizeHost(host);
				const site = host.id && sites[`${host.tenant || 'current'}-${host.id}`];
				if (site) {
					return site;
				} else {
					const data = {};
					if (host.id) {
						data.id = host.id;
					} else {
						data.domain = host.name;
					}
					return this.All.run('site.get', req, data);
				}
			}).then((site) => {
				host.id = site.id;
				sites[`${host.tenant || 'current'}-${host.id}`] = site;
				if (!site.data) site.data = {};

				if (host.tenant) {
					site.data.env = 'dev';
					site.data.domains = [];
					site.tenant = host.tenant;
				}

				// there was a miss, so update domains list
				const domains = (site.data.domains || []).concat(this.names.map((hn) => {
					return host.id + hn;
				}));
				host.name = domains[0];
				this.hosts.associate(host, domains);
				return site;
			}).catch((err) => {
				host.error = err;
				if (host.finalize) host.finalize();
			});
		}

		if (!host.installing && !host.error) {
			host.installing = host.searching.then((site) => {
				if (host.error) return;
				site.href = host.href;
				site.hostname = host.name;
				return this.All.install(site).catch(() => {
					// never throw an error since errors are already dealt with in install
				});
			});
		}
		if (!host.waiting && !host.error) {
			doWait(host);
		}
		return host;
	}

	resolvableHost(host) {
		const rec = this.ips[host.by];
		const hostname = host.name;
		return DNS.lookup(hostname, {
			all: false
		}).then((lookup) => {
			if (lookup.address == hostname) throw new Error("hostname is an ip " + hostname);
			const expected = rec['ip' + lookup.family];
			if (lookup.address != expected) {
				setTimeout(() => {
					// allow checking again in a minute
					if (host.error && host.error.statusCode == 503) delete host.error;
				}, 60000);
				throw new HttpError.ServiceUnavailable(`${hostname} ${lookup.family} ${lookup.address} does not match ${expected}`);
			}
		});
	}

	promote(site) {
		const cur = this.sites[site.id] || {};
		cur.errors = [];
		site.href = site.href || cur.href;
		site.hostname = site.hostname || cur.hostname || site.data.domains[0];
		site.errors = cur.errors;
	}

	replace(site) {
		const cur = this.sites[site.id];
		const oldList = cur && cur.data && cur.data.domains || [];
		const newList = site.data && site.data.domains || [];
		if (JSON.stringify(oldList) != JSON.stringify(newList)) {
			const host = this.hosts.get(cur.hostname);
			this.hosts.associate(host, newList);
		}
		this.sites[site.id] = site;
	}

	hold(site) {
		if (site.data.env == "production" && site.$model) return; // do not hold
		const host = this.hosts.get(site.hostname);
		if (!host) return;
		doWait(host);
	}

	release(site) {
		const host = this.hosts.get(site.hostname);
		if (!host) return;
		host.isWaiting = false;
		delete host.parked;
	}

	error(site, err) {
		try {
			if (!site.hostname) console.warn("All.domains.error(site) missing site.hostname");
			const host = this.hosts.get(site.hostname);
			if (!host) {
				console.error("Error", site.id, err);
				return;
			}
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

	normalizeHost(host) {
		if (host.id) return;
		const hn = host.name;
		const {
			groups: { tenant, id, domain }
		} = /^(?<tenant>[a-z0-9]+)-(?<id>[a-z0-9]+)(?<domain>\.[a-z0-9]+\.[a-z]+)$/.exec(hn) || { groups: {} };

		if (tenant && this.names.includes(domain)) {
			if (this.opt.database.url[tenant]) {
				host.tenant = tenant;
			} else {
				host.name = `${id}${domain}`;
			}
		}
		this.names.some((suffix) => {
			if (hn.endsWith(suffix)) {
				host.id = hn.substring(0, hn.length - suffix.length);
				return true;
			}
		});
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

function doWait(host) {
	if (host.finalize) return;
	host.isWaiting = true;
	const subpending = new Promise((resolve) => {
		host.finalize = function() {
			delete host.finalize;
			resolve();
		};
	});
	host.waiting = host.installing.then(() => {
		return subpending;
	});
}

