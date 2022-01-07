const Upcache = require.lazy('upcache');

const CacheState = require('./src/CacheState');

const state = new CacheState();

exports = module.exports = function(opt) {
	exports.install = state.install.bind(state);
	return {
		init: init,
		name: 'cache'
	};
};

function init(All) {
	All.cache.map = Upcache.map;
	All.cache.tag = paramSiteWrap(Upcache.tag);
	All.cache.for = paramSiteWrap(Upcache.tag.for);
	All.cache.disable = Upcache.tag.disable;
	return state.init(All).then(() => {
		All.app.get('*', Upcache.tag('app'));
		All.app.post('/.well-known/upcache', state.mw.bind(state), (req, res) => {
			res.sendStatus(204);
		});
	});
}

function paramSiteWrap(fn) {
	return function() {
		const mw = fn.apply(null, Array.from(arguments));
		function omw(req, res, next) {
			req.params.site = req.site.id;
			mw(req, res, next);
		}
		if (mw.for) omw.for = paramSiteWrap(mw.for);
		return omw;
	};
}
