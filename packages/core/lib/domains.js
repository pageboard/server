const DNS = {
	lookup: require('util').promisify(require('dns').lookup),
	reverse: require('util').promisify(require('dns').reverse)
};
const localhost4 = "127.0.0.1";
// const localhost6 = "::1";
const pageboardNames = [];
const pageboardIps = {};

module.exports = Domains;

function Domains(All) {
	this.All = All;
	this.sites = {}; // cache sites by id
	this.hosts = {}; // cache hosts by hostname
	this.mw = this.mw.bind(this);
	this.ready = false;
	this.holds = [];
}

Domains.prototype.unlock = function () {
	this.ready = true;
	for (const [req, res, next] of this.holds) this.mw(req, res, next);
	this.holds = null;
};
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
Domains.prototype.mw = function (req, res, next) {
	const All = this.All;
	const path = req.path;
	if (path == "/.well-known/pageboard" && req.hostname == localhost4) {
		this.wkp(req, res, next);
		return;
	} else if (!this.ready) {
		this.holds.push([req, res, next]);
		return;
	}

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
			if (host.isWaiting && !req.path.startsWith('/.') && All.opt.env != "development") {
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
		if (host._error) throw host._error;
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
		const path = req.path;
		// FIXME do not redirect if host.domains[0] DNS has not been checked
		if (req.hostname != host.domains[0]
			&& !path.startsWith('/.api/')
			&& !path.startsWith('/.well-known/')
			&& /^.well-known\/\d{3}$/.test(path)
		) {
			const rhost = this.init(host.domains[0], path, req.headers);
			rhost.waiting.then(() => {
				All.cache.tag('data-:site')(req, res, () => {
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
			const version = site.server || site.data.server || All.opt.version;
			if (version != All.opt.version) {
				res.set('X-Pageboard-Peer', All.opt.upstreams[version]);
				if (req.method == "GET") res.redirect(307, req.url);
				else next();
			} else {
				next();
			}
		}
	}).catch(next);
};

Domains.prototype.wkp = function (req, res, next) {
	All.run('site.all', req).then((list) => {
		const map = {};
		list.forEach((site) => {
			Object.assign(map, this.domainMapping(site));
		});
		res.type('json').end(JSON.stringify({
			domains: map
		}, null, ' '));

		if (!this.ready) setTimeout(() => {
			this.unlock();
		}, 1000);
	}).catch(next);
};

Domains.prototype.domainMapping = function(site) {
	const map = {};
	const rsite = this.sites[site.id];
	const version = rsite && rsite.server || site.data.server || All.opt.version;
	const upstream = All.opt.upstreams[version];
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
};

Domains.prototype.init = function(req) {
	const sites = this.sites;
	const hosts = this.hosts;
	const { headers } = req;
	let { hostname } = req;

	const { groups = {} } = /^(?<tenant>[a-z0-9]+)-(?<id>[a-z0-9]+)(?<domain>\.[a-z0-9]+\.[a-z]+)$/.exec(hostname) || {};
	if (pageboardNames.length == 0 && groups.tenant) {
		console.error("FIXME: tenant without pageboardNames", hostname);
	}
	if (pageboardNames.includes(groups.domain) && groups.tenant && All.opt.database.url[groups.tenant]) {
		hostname = `${groups.id}${groups.domain}`;
		req.tenant = groups.tenant;
	}
	const host = hosts[hostname] || {};
	if (!host.name) {
		host.name = hostname;
		hosts[hostname] = host;
		hostUpdatePort(host, headers.host);
		host.protocol = headers['x-forwarded-proto'] || 'http';
	}
	if (!host.searching && !host._error) {
		delete host._error;
		host.searching = Promise.resolve().then(() => {
			return this.check(host, headers['x-forwarded-by']);
		}).then((hostname) => {
			const site = host.id && sites[host.id];
			if (site) return site;
			let id;
			pageboardNames.some((hn) => {
				if (hostname.endsWith(hn)) {
					id = hostname.substring(0, hostname.length - hn.length);
					return true;
				}
			});
			const data = {
				domain: host.name
			};
			if (id) data.id = id; // search by domain and id
			return All.run('site.get', req, data);
		}).then((site) => {
			host.id = site.id;
			sites[site.id] = site;
			if (!site.data) site.data = {};

			// there was a miss, so update domains list
			const domains = (site.data.domains || []).concat(pageboardNames.map((hn) => {
				return host.id + hn;
			}));
			domains.forEach((domain) => {
				hosts[domain] = host;
			});
			hostUpdateDomain(host, domains[0]);
			host.domains = domains;
			return site;
		}).catch((err) => {
			host._error = err;
			if (host.finalize) host.finalize();
		});
	}

	if (!host.installing && !host._error) {
		host.installing = host.searching.then((site) => {
			if (host._error) return;
			site.href = host.href;
			site.hostname = host.name;
			return All.install(site).catch(() => {
				// never throw an error since errors are already dealt with in install
			});
		});
	}
	if (!host.waiting && !host._error) {
		doWait(host);
	}
	return host;
};

Domains.prototype.check = function(host, forwardedBy) {
	let fam = 4;
	let ip = forwardedBy;
	if (!ip) return Promise.reject(new Error("Missing X-Forwarded-By header"));
	if (isIPv6(ip)) fam = 6;

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

	const hostname = host.name;

	return Promise.resolve().then(() => {
		if (!pageboardIps[ip]) return DNS.reverse(ip).then((hostnames) => {
			pageboardIps[ip] = true;
			hostnames.forEach((hn) => {
				if (hn == "localhost") hn += ".localdomain";
				hn = '.' + hn;
				if (!pageboardNames.includes(hn)) pageboardNames.push(hn);
			});
		});
	}).then(() => {
		return DNS.lookup(hostname, {
			all: false
		}).then((lookup) => {
			if (lookup.address == hostname) throw new Error("hostname is an ip " + hostname);
			const expected = ips['ip' + lookup.family];
			if (lookup.address != expected) {
				setTimeout(() => {
					// allow checking again in a minute
					if (host._error && host._error.statusCode == 503) delete host._error;
				}, 60000);
				throw new HttpError.ServiceUnavailable(`${hostname} ${lookup.family} ${lookup.address} does not match ${expected}`);
			}
			return hostname;
		});
	});
};

Domains.prototype.promote = function(site) {
	const cur = this.sites[site.id] || {};
	cur.errors = [];
	site.href = site.href || cur.href;
	site.hostname = site.hostname || cur.hostname || site.data.domain;
	site.errors = cur.errors;
};

Domains.prototype.replace = function(site) {
	const cur = this.sites[site.id];
	const oldDomain = cur && cur.data && cur.data.domain;
	const newDomain = site.data && site.data.domain;
	if (oldDomain != newDomain) {
		if (oldDomain) {
			this.hosts[newDomain] = this.hosts[oldDomain];
			delete this.hosts[oldDomain];
		}
		if (!this.hosts[newDomain]) {
			this.hosts[newDomain] = this.hosts[site.hostname];
		}
	}
	this.sites[site.id] = site;
};

Domains.prototype.hold = function(site) {
	if (site.data.env == "production" && site.$model) return; // do not hold
	const host = this.hosts[site.hostname];
	if (!host) return;
	doWait(host);
};

Domains.prototype.release = function(site) {
	const host = this.hosts[site.hostname];
	if (!host) return;
	host.isWaiting = false;
	delete host.parked;
};

Domains.prototype.error = function(site, err) {
	try {
		if (!site.hostname) console.warn("All.domains.error(site) missing site.hostname");
		const host = this.hosts[site.hostname];
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
	} catch(ex) {
		console.error(ex);
	}
};

function hostUpdatePort(host, header) {
	const parts = header.split(':');
	const port = parts.length == 2 ? parseInt(parts[1]) : null;
	if (!Number.isNaN(port)) host.port = port;
	else delete host.port;
}

function hostUpdateDomain(host, name) {
	host.name = name;
	host.href = host.protocol + '://' + name + (host.port ? `:${host.port}` : '');
}

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

