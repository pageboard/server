var DNS = {
	lookup: require('util').promisify(require('dns').lookup),
	reverse: require('util').promisify(require('dns').reverse)
};
var pageboardNames;
module.exports = Domains;

function Domains(All) {
	this.All = All;
	this.sites = {}; // cache sites by id
	this.hosts = {}; // cache hosts by hostname
	this.init = this.init.bind(this);
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
Domains.prototype.init = function(req, res, next) {
	var All = this.All;
	var sites = this.sites;
	var hosts = this.hosts;
	var hostname = req.hostname;
	var host = hosts[hostname];
	if (!host) {
		hosts[hostname] = host = {name: hostname};
		var hostHeader = req.get('Host');
		if (!hostHeader) {
			console.error(req.headers);
			return next(new HttpError.BadRequest('Missing Host header'));
		}
		portUpdate(host, hostHeader);
	}
	if (!host.searching && !host._error) {
		delete host._error;
		host.isSearching = true;
		host.searching = Promise.resolve().then(function() {
			return this.check(host, req);
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
			return All.site.get(data).select('_id');
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
			hostUpdate(host, domains[0]);
			host.domains = domains;
			return site;
		}).catch(function(err) {
			host._error = err;
			if (host.finalize) host.finalize();
		}).finally(function() {
			host.isSearching = false;
		});
	}
	if (!host.installing && !host._error) {
		host.isInstalling = true;
		host.installing = host.searching.then(function(site) {
			if (host._error) return;
			site.href = host.href;
			site.hostname = host.name;
			// never throw an error since errors are already dealt with in install
			return All.install(site).catch(function() {});
		}).finally(function() {
			host.isInstalling = false;
		});
	}
	if (!host.waiting && !host._error) {
		doWait(host);
	}
	var p;
	if (req.path == "/.well-known/upcache") {
		if (host.finalize) {
			host.finalize();
		}
		p = host.installing;
	} else if (req.path == "/.well-known/pageboard") {
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
	return p.then(function() {
		if (!next) return;
		var site = sites[host.id];
		if (host._error) {
			next(host._error);
			return;
		}
		if (!host.id || !site) {
			// this should never actually happen !
			next(new HttpError.ServiceUnavailable(`Missing host.id or site for ${host.name}`));
			return;
		}
		var path = req.path;

		var errors = site.errors;
		if (path.startsWith('/.api/')) {
			// api needs a real site instance and be able to toy with it
			site = site.$clone();
		} else {
			// others don't
		}

		req.site = site;

		if (req.hostname != host.domains[0] && !path.startsWith('/.well-known/')) {
			All.cache.tag('data-:site')(req, res, function() {
				res.redirect(308, host.href +  req.url);
			});
			return;
		}

		site.href = host.href;
		site.hostname = host.name; // at this point it should be == host.domains[0]
		site.errors = errors;

		next();
	}).catch(next);
};

Domains.prototype.check = function(host, req) {
	var fam = 4;
	var localhost4 = "127.0.0.1";
	// var localhost6 = "::1";
	var ip = req.get('X-Forwarded-By');
	if (ip) {
		if (isIPv6(ip)) fam = 6;
	} else {
		var address = req.socket.address();
		ip = address.address;
		if (!ip) {
			console.warn("Missing client socket IP", req.hostname, req.path);
			ip = localhost4;
		}
		fam = address.family == 'IPv6' ? 6 : 4;
	}
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
		if (!pageboardNames) return DNS.reverse(ip).then(function(hostnames) {
			pageboardNames = hostnames.map(function(hn) {
				if (hn == "localhost") hn += ".localdomain";
				return '.' + hn;
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
	var href = site.href || cur.href;
	Object.defineProperty(site, 'href', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: href
	});
	var hostname = site.hostname || cur.hostname || site.data.domain;
	Object.defineProperty(site, 'hostname', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: hostname
	});
	Object.defineProperty(site, 'errors', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: cur.errors
	});
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

function portUpdate(host, header) {
	var parts = header.split(':');
	var port = parts.length == 2 ? parseInt(parts[1]) : null;
	if (!isNaN(port)) host.port = port;
	else delete host.port;
}

function hostUpdate(host, name) {
	host.name = name;
	var port = host.port;
	var protocol = "http";
	if (port) {
		var right = port % 1000;
		if (right == 80) {
			port += - 80 + 443;
			protocol = "https";
		} else if (right == 443) {
			protocol = "https";
		}
	} else {
		protocol = "https";
	}
	host.href = protocol + '://' + name + (port ? `:${port}` : '');
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

