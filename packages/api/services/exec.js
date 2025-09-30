const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

const { mergeExpressions, unflatten } = require('../../../src/utils');

module.exports = class ShellService {
	static name = 'exec';

	constructor(app, opts) {
		for (const [name, schema] of Object.entries(opts)) {
			this.constructor[name] = schema;
			const { path, cwd, args } = schema;
			delete schema.path;
			delete schema.cwd;
			delete schema.args;
			Object.defineProperty(Object.getPrototypeOf(this), name, {
				value(req, data) {
					this.#process(req, data, { path, args, cwd });
				},
				writable: false,
				enumerable: false,
				configurable: false
			});
		}
	}

	async #process(req, data, { path, args, cwd }) {
		const list = args.split(" ");
		args = mergeExpressions({}, list, { $request: data });
		const { stdout } = await execFile(path, args, { cwd });
		const ret = {};
		for (const line of stdout.split('\n')) {
			const [key, val] = line.split(':').map(x => x.trim());
			ret[key] = val;
		}
		return unflatten(ret);
	}
};
