const bodyParser = require.lazy('body-parser');

const { unflatten } = require('./utils');

module.exports = function (group, router) {
	return Object.assign(router, {
		group,
		read(routes, handler) {
			if (!Array.isArray(routes)) routes = [routes];
			for (const route of routes) this.get(
				route,
				async (req, res, next) => {
					try {
						if (typeof handler == "string") {
							const apiStr = handler;
							handler = async req => {
								return req.filter(await req.run(apiStr, unflatten(req.query)));
							};
						}
						const data = await handler(req);
						this.reply(req, data);
					} catch (err) {
						next(err);
					}
				}
			);
		},

		write(routes, handler) {
			if (!Array.isArray(routes)) routes = [routes];
			for (const route of routes) this.post(
				route,
				bodyParser.json({
					limit: '1000kb',
					verify(req, res, buf) {
						req.buffer = buf;
					}
				}),
				bodyParser.urlencoded({ extended: false, limit: '100kb' }),
				async (req, res, next) => {
					try {
						if (typeof handler == "string") {
							const apiStr = handler;
							handler = async req => {
								return req.filter(await req.run(apiStr, unflatten(req.body)));
							};
						}
						const data = await handler(req);
						this.reply(req, data);
					} catch (err) {
						next(err);
					}
				}
			);
		},

		reply(req, obj) {
			const { res, finitions } = req;

			setTimeout(async () => {
				while (finitions.length) {
					const finition = finitions.shift();
					try {
						await finition(req);
					} catch (err) {
						console.error(err);
					}
				}
			});
			if (obj == null) {
				res.sendStatus(204);
				return;
			}
			if (typeof obj == "string" || Buffer.isBuffer(obj)) {
				if (!res.get('Content-Type')) res.type('text/plain');
				res.send(obj);
				return;
			}
			if (typeof obj != "object") {
				// eslint-disable-next-line no-console
				console.trace("router.reply expects an object, got", obj);
				obj = {};
			}
			if (obj.cookies) {
				const cookieParams = {
					httpOnly: true,
					sameSite: true,
					secure: req.$url.protocol == "https:",
					path: '/'
				};
				for (const [key, cookie] of Object.entries(obj.cookies)) {
					const val = cookie.value;
					const maxAge = cookie.maxAge;

					if (val == null || maxAge == 0) {
						res.clearCookie(key, cookieParams);
					} else res.cookie(key, val, {
						...cookieParams,
						maxAge: maxAge
					});
				}
				delete obj.cookies;
			}
			if (req.user.grants.length) {
				res.set('X-Pageboard-Grants', req.user.grants.join(','));
			}
			if (obj.$statusText) {
				res.statusMessage = obj.$statusText;
				delete obj.$statusText;
			}
			if (obj.$status) {
				const code = Number.parseInt(obj.$status);
				if (code < 200 || code >= 600 || Number.isNaN(code)) {
					console.error("Unknown error code", obj.$status);
					res.status(500);
				} else {
					res.status(code);
				}
				delete obj.$status;
			}
			if (obj.location) {
				res.redirect(obj.location);
			}
			if (obj.item && !obj.item.type) {
				// 401 Unauthorized: missing or bad authentication
				// 403 Forbidden: authenticated but not authorized
				res.status(req.user.id ? 403 : 401);
			}
			if (req.granted) {
				res.set('X-Pageboard-Granted', 1);
			}

			if (req.types.size > 0) {
				res.set('X-Pageboard-Elements', Array.from(req.types).join(','));
			}

			res.json(obj);
		}
	});
};
