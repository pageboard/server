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
}

/*
maintain a cache (hosts) of requested hostnames
- each hostname is checked to resolve to pageboard current IP (which is resolved and cached,
so adding an IP to pageboard and pointing a host to that IP needs a restart)
- then each hostname, if it is a subdomain of pageboard, gives a site.id, or if not, a site.domain
- site instance is loaded and cached
- /.well-known/pageboard returns here
- site is installed and init() is holded by a hanging promise
- site installation calls upcache update url, which resolves the hanging promise
- init returns for everyone
*/
Domains.prototype.mw = function(req, res, next) {
	var All = this.All;
	var path = req.path;
	var host = this.init(req.hostname, path, req.headers);
	var p;
	if (path == "/.well-known/upcache") {
		if (host.finalize) {
			host.finalize();
		}
		p = host.installing;
	} else if (path == "/.well-known/pageboard") {
		if (req.accepts('json')) p = host.waiting;
		else p = host.searching;
	} else if (req.path == "/favicon.ico" || req.path.startsWith('/.files/') || req.path.startsWith('/.api/')) {
		p = host.waiting;
	} else if (host.isWaiting) {
		p = new Promise(function(resolve) {
			setTimeout(resolve, host.parked ? 0 : 2000);
		}).then(function() {
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
		var site = this.sites[host.id];
		if (!host.id || !site) {
			// this should never actually happen !
			throw new HttpError.ServiceUnavailable(`Missing host.id or site for ${host.name}`);
		}
		// calls to api use All.run which does site.$clone() to avoid concurrency issues
		req.site = site;
		return site;
	}).then((site) => {
		if (!next) return;
		var path = req.path;
		// FIXME do not redirect if host.domains[0] DNS has not been checked
		if (req.hostname != host.domains[0] && (
			!path.startsWith('/.api/') || !path.startsWith('/.well-known/') || /^.well-known\/\d{3}$/.test(path)
		)) {
			var rhost = this.init(host.domains[0], path, req.headers);
			rhost.waiting.then(function() {
				All.cache.tag('data-:site')(req, res, function() {
					res.redirect(308, rhost.href +  req.url);
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

		if (path == "/.well-known/pageboard") {
			// this is expected by proxy/statics/status.html
			res.send({
				errors: site.errors
			});
		} else {
			var version = site.server || site.data.server || All.opt.version;
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

Domains.prototype.wkp = function(req, res, next) {
	if (req.hostname != localhost4) return next();
	All.run('site.all', req).then((list) => {
		var map = {};
		list.forEach((site) => {
			Object.assign(map, this.domainMapping(site));
		});
		res.type('json').end(JSON.stringify({
			domains: map
		}, null, ' '));
	}).catch(next);
};

Domains.prototype.domainMapping = function(site) {
	var map = {};
	var rsite = this.sites[site.id];
	var version = rsite && rsite.server || site.data.server || All.opt.version;
	var upstream = All.opt.upstreams[version];
	var domains = site.data.domains;
	if (!domains) domains = [];
	else if (typeof domains == "string") domains = [domains];
	var domain = domains.shift();
	if (domain != null) {
		domains = domains.slice();
		domains.push(site.id);
		domains.forEach(function(secondary) {
			map[secondary] = '=' + domain;
		});
		map[domain] = upstream;
	} else {
		map[site.id] = upstream;
	}
	return map;
};

Domains.prototype.init = function(hostname, path, headers) {
	var sites = this.sites;
	var hosts = this.hosts;
	var host = hosts[hostname];
	if (!host) {
		hosts[hostname] = host = {name: hostname};
		hostUpdatePort(host, headers.host);
		host.protocol = headers['x-forwarded-proto'] || 'http';
	}
	if (!host.searching && !host._error) {
		delete host._error;
		host.searching = Promise.resolve().then(function() {
			return this.check(host, headers['x-forwarded-by']);
		}.bind(this)).then(function(hostname) {
			var site = host.id && sites[host.id];
			if (site) return site;
			var id;
			pageboardNames.some(function(hn) {
				if (hostname.endsWith(hn)) {
					id = hostname.substring(0, hostname.length - hn.length);
					return true;
				}
			});
			var data = {
				domain: host.name
			};
			if (id) data.id = id; // search by domain and id
			return All.site.get({}, data).select('_id');
		}).then(function(site) {
			host.id = site.id;
			sites[site.id] = site;
			if (!site.data) site.data = {};

			// there was a miss, so update domains list
			var domains = (site.data.domains || []).concat(pageboardNames.map(function(hn) {
				return host.id + hn;
			}));
			domains.forEach(function(domain) {
				hosts[domain] = host;
			});
			hostUpdateDomain(host, domains[0]);
			host.domains = domains;
			return site;
		}).catch(function(err) {
			host._error = err;
			if (host.finalize) host.finalize();
		});
	}

	if (!host.installing && !host._error) {
		host.installing = host.searching.then(function(site) {
			if (host._error) return;
			site.href = host.href;
			site.hostname = host.name;
			return All.install(site).catch(function() {
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
	var fam = 4;
	var ip = forwardedBy;
	if (!ip) return Promise.reject(new Error("Missing X-Forwarded-By header"));
	if (isIPv6(ip)) fam = 6;

	var ips = {};
	ips['ip' + fam] = ip;
	var prefix = '::ffff:';
	if (fam == 6) {
		if (ip.startsWith(prefix)) {
			var tryFour = ip.substring(prefix.length);
			if (!isIPv6(tryFour)) {
				ips.ip4 = tryFour;
				ip = tryFour;
			}
		}
	}

	var hostname = host.name;

	return Promise.resolve().then(function() {
		if (!pageboardIps[ip]) return DNS.reverse(ip).then(function(hostnames) {
			pageboardIps[ip] = true;
			hostnames.forEach(function(hn) {
				if (hn == "localhost") hn += ".localdomain";
				hn = '.' + hn;
				if (!pageboardNames.includes(hn)) pageboardNames.push(hn);
			});
		});
	}).then(function() {
		return DNS.lookup(hostname, {
			all: false
		}).then(function(lookup) {
			if (lookup.address == hostname) throw new Error("hostname is an ip " + hostname);
			var expected = ips['ip' + lookup.family];
			if (lookup.address != expected) {
				setTimeout(function() {
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
	var cur = this.sites[site.id] || {};
	cur.errors = [];
	site.href = site.href || cur.href;
	site.hostname = site.hostname || cur.hostname || site.data.domain;
	site.errors = cur.errors;
};

Domains.prototype.replace = function(site) {
	var cur = this.sites[site.id];
	var oldDomain = cur && cur.data && cur.data.domain;
	var newDomain = site.data && site.data.domain;
	if (oldDomain != newDomain) {
		this.hosts[newDomain] = this.hosts[oldDomain] || this.hosts[site.hostname];
		if (oldDomain) delete this.hosts[oldDomain];
	}
	this.sites[site.id] = site;
};

Domains.prototype.hold = function(site) {
	if (site.data.env == "production" && site.$model) return; // do not hold
	var host = this.hosts[site.hostname];
	if (!host) return;
	doWait(host);
};

Domains.prototype.release = function(site) {
	var host = this.hosts[site.hostname];
	if (!host) return;
	host.isWaiting = false;
	delete host.parked;
};

Domains.prototype.error = function(site, err) {
	try {
		if (!site.hostname) console.warn("All.domains.error(site) missing site.hostname");
		var host = this.hosts[site.hostname];
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
	var parts = header.split(':');
	var port = parts.length == 2 ? parseInt(parts[1]) : null;
	if (!isNaN(port)) host.port = port;
	else delete host.port;
}

function hostUpdateDomain(host, name) {
	host.name = name;
	host.href = host.protocol + '://' + name + (host.port ? `:${host.port}` : '');
}

function errorObject(site, err) {
	var std = err.toString();
	var errObj = {
		name: err.name,
		message: err.message
	};
	if (err.stack) errObj.stack = err.stack.split('\n').map(function(line) {
		if (line == std) return;
		var index = line.indexOf("/pageboard/");
		if (index >= 0) return line.substring(index);
		if (/^\s*at\s/.test(line)) return;
		return line;
	}).filter(x => !!x).join('\n');

	return errObj;
}

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}

function doWait(host) {
	if (host.finalize) return;
	host.isWaiting = true;
	var subpending = new Promise(function(resolve) {
		host.finalize = function() {
			delete host.finalize;
			resolve();
		};
	});
	host.waiting = host.installing.then(function() {
		return subpending;
	});
}

