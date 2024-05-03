module.exports = class KQueue {
	#map = new Map();
	push(key, fn) {
		const obj = this.#map.get(key) ?? { p: Promise.resolve() };
		if (!obj.count) {
			obj.count = 0;
			this.#map.set(key, obj);
		}
		obj.count++;
		obj.p = obj.p.then(fn);
		return obj.p.finally(() => {
			if (--obj.count == 0) {
				this.#map.delete(key);
			}
		});
	}
};
