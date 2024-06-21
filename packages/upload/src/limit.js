const { Transform } = require('node:stream');

module.exports = class LimitStream extends Transform {
	#limit;
	#count = 0;
	constructor(limit = 0) {
		super();
		this.#limit = limit;
	}
	_transform(chunk, enc, cb) {
		const count = this.#count += chunk.length;
		if (count > this.#limit) cb(new Error("Limit reached: " + this.#limit));
		else cb(null, chunk);
	}
};
