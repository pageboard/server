const hookStd = require('hook-std');


module.exports = class Logger {
	constructor() {
		this.buffers = [];
		this.hook = hookStd.stdout(function(output, unhook) {
			if (!this.unhook) this.unhook = unhook;
			this.buffers.push(output);
		}.bind(this));
	}

	clear(stop) {
		if (stop && this.unhook) this.unhook();
		this.buffers = [];
	}

	flush(stop) {
		if (stop && this.unhook) this.unhook();
		this.buffers.forEach(function(buf) {
			process.stdout.write(buf);
		});
	}
};


