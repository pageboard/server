const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { randomBytes } = require('crypto');
const Path = require('path');
const merge = require('lodash.merge');

const bin = Path.join(__dirname, '..', 'bin', 'pageboard');

exports.cli = async (...args) => {
	try {
		const { stdout } = await execFile(bin, args);
		return JSON.parse(stdout);
	} catch (err) {
		if (err.stderr) throw new Error(err.stderr);
		else throw err;
	}
};

exports.genId = () => {
	return randomBytes(12).toString('hex');
};

exports.merge = merge;
