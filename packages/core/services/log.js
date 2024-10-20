const morgan = require('morgan');
const pad = require('pad');


module.exports = class LogService {
	static name = 'log';
	static $global = true;

	#log;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async apiRoutes(router) {
		const { default: prettyBytes } = await import('pretty-bytes');
		morgan.token('method', (req, res) => {
			return pad((req.call('prerender.prerendering') ? '*' : '') + req.method, 4);
		});
		morgan.token('status', (req, res) => {
			return pad(3, res.statusCode);
		});
		morgan.token('time', (req, res) => {
			const ms = morgan['response-time'](req, res, 0);
			if (ms) return pad(4, ms) + 'ms';
			else return pad(6, '');
		});
		morgan.token('type', (req, res) => {
			return pad(4, (res.get('Content-Type') || '-').split(';').shift().split('/').pop());
		});
		morgan.token('size', (req, res) => {
			const len = parseInt(res.get('Content-Length'));
			return pad(6, (len && prettyBytes(len) || '0 B').replaceAll(' ', ''));
		});
		morgan.token('site', (req, res) => {
			return pad(res.locals.site && res.locals.site.substring(0, 8) || "-", 8);
		});

		this.#log = morgan(this.opts.format, {
			skip: function (req, res) {
				return false;
			}
		});
		router.use(this.#log);
	}

	manual(req) {
		this.#log(req, req.res, () => { });
	}
	static manual = { $private: true };
};
