const { Deferred } = require('class-deferred');

module.exports = class Queue {
	#list = [];
	#wait;
	#done;
	#hold = Promise.resolve();

	constructor(final) {
		this.#wait = new Deferred();
		if (final) this.#wait.finally(() => final());
		this.#done = this.#wait.then(ret => {
			return this.#hold.then(() => {
				return ret;
			});
		}).catch(err => {
			return this.#hold.then(() => {
				throw err;
			});
		});
	}

	async idle() {
		await this.#done;
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
		const n = this.#list.shift() || this.#wait;
		n.reject(err);
	}
};
