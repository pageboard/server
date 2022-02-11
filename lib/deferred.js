module.exports = class Deferred extends Promise {
	constructor(final) {
		let pass, fail;
		super((resolve, reject) => {
			pass = resolve;
			fail = reject;
		});
		this.resolve = (obj) => {
			final();
			pass(obj);
		};
		this.reject = (err) => {
			final();
			fail(err);
		};
	}
};
