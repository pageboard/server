
class Host {
	constructor(hostname, headers) {
		this.name = hostname;
		this.by = headers['x-forwarded-by'];
		this.updatePort(headers.host);
		this.protocol = headers['x-forwarded-proto'] || 'http';
	}
	updatePort(host) {
		const parts = host.split(':');
		const port = parts.length == 2 ? parseInt(parts[1]) : null;
		if (!Number.isNaN(port)) this.port = port;
		else this.port = null;
	}
	get href() {
		return this.protocol + '://' + this.name + (this.port ? `:${this.port}` : '');
	}
}

class Hosts {
	constructor() {
		this.cache = {};
	}
	provision({ hostname, headers }) {
		let host = this.cache[hostname];
		if (!host) {
			host = this.cache[hostname] = new Host(hostname, headers);
		}
		return host;
	}
	associate(host, domains) {
		if (host.domains) {
			for (const domain of host.domains) this.cache[domain] = null;
		}
		host.domains = domains;
		for (const domain of domains) this.cache[domain] = host;
	}
	get(hostname) {
		return this.cache[hostname];
	}
}

module.exports = Hosts;
