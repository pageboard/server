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
	var self = this;
	var sites = this.sites;
	var hosts = this.hosts;
	var hostname = req.hostname;
	var host = hosts[hostname];
	if (!host) {
		hosts[hostname] = host = {
			name: hostname
		};
	}
	if (host._error) {
		return next(host._error);
	}
	if (!host.searching) {
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
			if (site.id == "pageboard") throw new HttpError.NotFound("site cannot have id='pageboard'");
			host.id = site.id;
			sites[site.id] = site;
			if (!site.data) site.data = {};
			if (!site.hostname) site.hostname = host.name;
			if (site.data.domain && !hosts[site.data.domain]) {
				// alienate current hostname with official data.domain
				hosts[site.data.domain] = host;
			}
			return site;
		}).catch(function(err) {
			host._error = err;
			throw err;
		}).finally(function() {
			host.isSearching = false;
		});
	}
	if (!host.installing) {
		host.isInstalling = true;
		host.installing = host.searching.then(function(site) {
			site.href = host.href;
			site.hostname = host.name;
			return All.install(site);
		}).finally(function() {
			host.isInstalling = false;
		});
	}
	if (!host.waiting) {
		doWait(host);
	}

	if (req.path == "/.well-known/upcache") {
		if (host.finalize) {
			host.finalize();
			delete host.finalize;
		}
		p = host.installing;
	} else if (req.path == "/.well-known/pageboard") {
		p = host.searching;
	} else if (req.path == "/favicon.ico" || req.path.startsWith('/.files/') || req.path.startsWith('/.api/')) {
		p = host.waiting;
	} else if (req.path == "/.well-known/status.html") {
		return next();
	} else if (req.path == "/.well-known/status.json") {
		p = host.waiting;
	} else if (host.isWaiting) {
		p = new Promise(function(resolve) {
			setTimeout(resolve, 2000);
		}).then(function() {
			if (host.isWaiting) {
				next = null;
				res.redirect("/.well-known/status.html?" + encodeURIComponent(req.url));
			} else {
				return host.waiting;
			}
		});
	} else {
		p = host.waiting;
	}
	return p.then(function() {
		if (!next) return;
		var site = self.sites[host.id];
		var Block = site.Block;
		var errors = site.errors;
		if (req.url.startsWith('/.api/')) {
			// api needs a real site instance and be able to toy with it
			site = site.$clone();
		} else {
			// others don't
		}

		site.href = host.href;
		site.hostname = host.name;
		site.errors = errors;
		site.Block = Block;

		req.site = site;
		req.upgradable = host.upgradable;
		next();
	}).catch(next);
};

Domains.prototype.check = function(host, req) {
	var fam = 4;
	var localhost4 = "127.0.0.1";
	var localhost6 = "::1";
	var ip = req.get('X-Forwarded-By');
	if (ip) {
		if (isIPv6(ip)) fam = 6;
	} else {
		var address = req.socket.address();
		ip = address.address;
		if (!ip) {
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
			if (!isIPv6(tryFour)) ips.ip4 = tryFour;
		}
	}
	var local = false;
	if (ips.ip4 == localhost4) {
		local = true;
		if (!ips.ip6) ips.ip6 = localhost6;
	} else if (ips.ip6 == localhost6) {
		local = true;
		if (!ips.ip4) ips.ip4 = localhost4;
	}

	host.local = local;
	host.upgradable = req.get('Upgrade-Insecure-Requests') && !local;
	host.href = (host.upgradable ? 'https' : req.protocol) + '://' + req.get('Host');

	var hostname = host.name;

	return Promise.resolve().then(function() {
		if (!pageboardNames) {
			if (local) {
				if (hostname == "localhost") hostname += ".localdomain";
				var parts = hostname.split('.');
				parts[0] = "";
				pageboardNames = [parts.join('.')];
			} else {
				return DNS.reverse(ip).then(function(hostnames) {
					pageboardNames = hostnames.map(function(hn) {
						return '.' + hn;
					});
				});
			}
		}
	}).then(function() {
		if (host.local) return hostname;
		return DNS.lookup(hostname, {
			all: false
		}).then(function(lookup) {
			if (lookup.address == hostname) throw new Error("hostname is an ip " + hostname);
			var expected = ips['ip' + lookup.family];
			if (lookup.address != expected) {
				throw new HttpError.NotFound(`Wrong ip${lookup.family} for hostname: ${lookup.address}
				expected ${expected}`);
			}
			return hostname;
		});
	});
};

Domains.prototype.update = function(site) {
	var cur = this.sites[site.id] || {};
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
		value: []
	});
	var Block = site.Block || cur.Block;
	Object.defineProperty(site, 'Block', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: Block
	});
	this.sites[site.id] = site;
};

Domains.prototype.hold = function(site) {
	var host = this.hosts[site.hostname];
	if (!host) return;
	doWait(host);
};

Domains.prototype.release = function(site) {
	var host = this.hosts[site.hostname];
	if (!host) return;
	if (site.errors.length == 0) host.isWaiting = false;
};

Domains.prototype.error = function(site, err) {
	if (!site.hostname) console.warn("All.domains.error(site) missing site.hostname");
	var host = this.hosts[site.hostname];
	if (!host) {
		console.error("Error", site.id, err);
		return;
	}
	site.errors.push(err);
	host.isWaiting = true;
};

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}

function doWait(host) {
	if (host.finalize) return;
	host.isWaiting = true;
	var subpending = new Promise(function(resolve) {
		host.finalize = resolve;
	});
	host.waiting = host.installing.then(function() {
		return subpending;
	});
}

