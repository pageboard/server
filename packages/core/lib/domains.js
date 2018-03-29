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
			if (site.data.domain && !hosts[site.data.domain]) {
				// TODO migrate host to new site.data.domain
				throw new HttpError.NotFound(`site ${site.id} cannot change domain
				${hostname} => ${site.data.domain}`);
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
			return All.install(site);
		}).finally(function() {
			host.isInstalling = false;
		});
	}
	if (!host.waiting) {
		host.isWaiting = true;
		var subpending = new Promise(function(resolve) {
			host.finalize = resolve;
		});
		host.waiting = host.installing.then(function(site) {
			return subpending.then(function() {
				return site;
			});
		}).finally(function() {
			host.isWaiting = false;
		});
	}

	if (req.url == "/.well-known/upcache") {
		if (host.finalize) {
			host.finalize();
			delete host.finalize;
		}
		p = host.installing;
	} else if (req.url == "/.well-known/pageboard") {
		p = host.searching;
	} else if (req.url.startsWith('/.files/') || req.url.startsWith('/.api/')) {
		p = host.waiting;
	} else if (req.path.startsWith("/.well-known/status.html")) {
		return next();
	} else if (req.url.startsWith("/.well-known/status.json")) {
		p = host.waiting;
	} else if (host.isWaiting) {
		return res.redirect("/.well-known/status.html?" + encodeURIComponent(req.url));
	} else {
		p = host.waiting;
	}
	return p.then(function(site) {
		// let's optimize this
		var errors = site.errors;
		if (req.url.startsWith('/.api/')) {
			site = site.$clone();
		} else {
			site = {
				id: site.id
			};
		}
		if (!site.data) site.data = {};
		if (!site.data.domain) site.data.domain = host.name;

		site.href = host.href;
		req.site = site;
		req.upgradable = host.upgradable;
		next();
	}).catch(next);
};

Domains.prototype.check = function(host, req) {
	var fam = 4;
	var ip = req.get('X-Forwarded-By');
	if (ip) {
		if (isIPv6(ip)) fam = 6;
	} else {
		var address = req.socket.address();
		ip = address.address;
		fam = address.family == 'IPv6' ? 6 : 4;
	}
	var ips = {};
	ips['ip' + fam] = ip;
	var localhost4 = "127.0.0.1";
	var localhost6 = "::1";
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

	host.upgradable = req.get('Upgrade-Insecure-Requests') && !local;
	host.href = (host.upgradable ? 'https' : req.protocol) + '://' + req.get('Host');

	var hostname = host.name;

	var p = Promise.resolve();

	if (!pageboardNames) {
		if (local) {
			pageboardNames = ['.localdomain'];
		} else {
			p = DNS.reverse(ip).then(function(hostnames) {
				pageboardNames = hostnames.map(function(hn) {
					return '.' + hn;
				});
			});
		}
	}
	p = p.then(function() {
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
	return p;
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
	var errors = site.errors || cur.errors;
	Object.defineProperty(site, 'errors', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: errors
	});
	this.sites[site.id] = site;
};

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}
