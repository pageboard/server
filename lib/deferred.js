module.exports = class Deferred extends Promise {
	constructor(final) {
		let pass, fail;
		super((resolve, reject) => {
			pass = resolve;
			fail = reject;
		});
		this.resolve = (obj) => {
			if (final) final();
			pass(obj);
		};
		this.reject = (err) => {
			if (final) final();
			fail(err);
		};
	}
	static get [Symbol.species]() {
		return Promise;
	}
	get [Symbol.toStringTag]() {
		return 'Deferred';
	}
};
