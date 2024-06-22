const { Deferred } = require('class-deferred');

module.exports = class Queue {
	#list = [];
	#wait;
	#err;
	#done;
	#hold = new Deferred();

	constructor(final) {
		this.#wait = new Deferred();
		if (final) this.#wait.finally(() => final());
		this.#done = this.#wait.then(ret => {
			return this.#hold.then(() => {
				return ret;
			});
		});
	}

	idle() {
		return this.#done.then(ret => {
			// safe rethrow
			if (this.#err) throw this.#err;
			this.#err = null;
			return ret;
		});
	}
	hold() {
		this.#hold = new Deferred();
	}
	release() {
		this.#hold.resolve();
	}
	push(fn) {
		const defer = new Deferred();
		defer.then(fn)
			.then(ret => this.#resolve(ret))
			.catch(err => this.#reject(err));
		this.#list.push(defer);
		if (this.#list.length == 1) {
			this.#resolve();
		}
	}
	#resolve(ret) {
		const n = this.#list.shift() || this.#wait;
		n.resolve(ret);
	}
	#reject(err) {
		this.#err = err;
		this.#wait.resolve();
	}
};
