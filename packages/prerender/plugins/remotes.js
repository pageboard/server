module.exports = function remotesPlugin(page, settings, req, res) {
	const { url: baseUrl } = req.site;
	page.route(
		rurl => rurl.host != baseUrl.host,
		(route, request) => {
			// requests to other hosts are cached using proxy and user-agent
			const url = new URL(request.url());
			const { host } = url;
			url.hostname = baseUrl.hostname;
			url.port = baseUrl.port;
			route.continue({
				headers: {
					...request.headers(),
					'X-Proxy-Host': host
				},
				url: url.href
			});
		}
	);
};
