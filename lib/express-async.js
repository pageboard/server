module.exports = (express) => {
	express.Router.use = wrap(express.Router.use);
	for (const method of ['get', 'post', 'delete', 'patch', 'put']) {
		express.Route.prototype[method] = wrap(express.Route.prototype[method]);
	}
	return express;
};

function wrap(meth) {
	return function (...list) {
		const nlist = list.flat().map((item) => {
			if (typeof item != "function") {
				return item;
			}
			if (item.length >= 3) {
				// middleware expects err?, req, res, next
				return item;
			}
			return async (...args) => {
				const next = args[args.length - 1];
				const res = args[args.length - 2];
				try {
					const data = await item(...args);
					if (res.writableEnded || res.statusCode >= 300) {
						return;
					}
					if (data === undefined) {
						next();
					} else if (typeof data == "number") {
						res.sendStatus(data);
					} else if (data === null) {
						res.sendStatus(204);
					} else if (Buffer.isBuffer(data) || typeof data != "object") {
						res.send(data);
					} else {
						res.json(data);
					}
				} catch (err) {
					next(err);
				}
			};
		});
		return meth.apply(this, nlist);
	};
}
