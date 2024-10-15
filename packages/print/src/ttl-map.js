module.exports = class TTLMap extends Map {
	#ttl;
	#timers = new Map();

	constructor(ttl = 0) {
		super();
		this.#ttl = ttl;
	}

	delete(key) {
		super.delete(key);
		clearTimeout(this.#timers.get(key));
		this.#timers.delete(key);
	}

	set(key, value, ttl = this.#ttl) {
		super.set(key, value);
		if (this.#timers.has(key)) {
			clearTimeout(this.#timers.get(key));
		}

		const timer = setTimeout(() => {
			super.delete(key);
		}, ttl);
		this.#timers.set(key, timer);
	}

	get(key) {
		return super.get(key);
	}
};
