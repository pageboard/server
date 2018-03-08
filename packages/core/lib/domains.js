var DNS = require('dns');

module.exports = Domains;

function Domains(All) {
	this.All = All;
	this.map = {};
}

Domains.prototype.get = function(domain) {
	return this.map[domain];
};

Domains.prototype.set = function(domain, obj) {
	var prev = this.map[domain];
	if (!prev) prev = this.map[domain] = {};
	Object.assign(prev, obj);
	return prev;
};

Domains.prototype.init = function(req) {
	var api = this.All.api;
	var domain = req.hostname;
	var obj = this.get(domain) || this.set(domain, {});
	if (obj.error) {
		return Promise.reject(obj.error);
	}
	if (obj.resolvable) {
		return obj.resolvable;
	}
	var fam = 4;
	var ip = req.get('X-Forwarded-By');
	if (ip) {
		if (isIPv6(ip)) fam = 6;
	} else {
		var address = req.socket.address();
		ip = address.address;
		fam = address.family == 'IPv6' ? 6 : 4;
	}
	obj['ip' + fam] = ip;
	var localhost4 = "127.0.0.1";
	var localhost6 = "::1";
	var prefix = '::ffff:';
	if (fam == 6) {
		if (ip.startsWith(prefix)) {
			var tryFour = ip.substring(prefix.length);
			if (!isIPv6(tryFour)) obj.ip4 = tryFour;
		}
	}
	var local = false;
	if (obj.ip4 == localhost4) {
		local = true;
		if (!obj.ip6) obj.ip6 = localhost6;
	} else if (obj.ip6 == localhost6) {
		local = true;
		if (!obj.ip4) obj.ip4 = localhost4;
	}
	obj.upgradable = req.get('Upgrade-Insecure-Requests') && !local;

	obj.host = (obj.upgradable ? 'https' : req.protocol) + '://' + req.get('Host');
	obj.resolvable = new Promise(function(resolve, reject) {
		DNS.lookup(domain, {
			all: false,
		}, function(err, address, family) {
			if (address == domain) return reject(new Error("domain is an ip " + domain));
			if (err) return reject(err);
			var expected = obj['ip' + family];
			if (address == expected) {
				return resolve(true);
			} else {
				reject(new HttpError.NotFound(`Wrong ip for domain: ${address}, expected ${expected}`));
			}
		});
	});
	return obj.resolvable.then(function() {
		// and initialize Block
		return api.initDomainBlock(domain, obj);
	}).catch(function(err) {
		obj.error = err;
		throw err;
	});
};

function isIPv6(ip) {
	return ip.indexOf(':') >= 0;
}
