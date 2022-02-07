module.exports = class Deferred extends Promise {
	constructor(final) {
		super((pass, fail) => {
			this.resolve = (obj) => {
				final();
				pass(obj);
			};
			this.reject = (err) => {
				final();
				fail(err);
			};
		});
		this.final = final;
	}
};
