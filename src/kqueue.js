const { Deferred } = require.lazy('class-deferred');

module.exports = class KQueue {
	#map = new Map();
	push(key, fn) {
		const d = new Deferred();
		const obj = this.#map.get(key) ?? { p: Promise.resolve() };
		if (!obj.count) {
			obj.count = 0;
			this.#map.set(key, obj);
		}
		obj.count++;
		obj.p = obj.p.then(fn).then(res => {
			d.resolve(res);
		}).catch (err => {
			d.reject(err);
		}).finally(() => {
			if (--obj.count == 0) {
				this.#map.delete(key);
			}
		});
		return d;
	}
};
