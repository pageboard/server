const cspHeader = 'Content-Security-Policy';

exports.plugin = function(page, settings, request, response) {
	page.when('idle', function() {
		const conf = All.opt.report;
		if (conf.csp) {
			let csp = response.get(cspHeader);
			if (csp && !csp.includes('report-uri ')) {
				csp += `; report-uri ${conf.csp}`;
				response.set(cspHeader, csp);
			}
		}

		const csp = response.get(cspHeader);
		if (csp && All.opt.csp) {
			response.set(cspHeader, csp.fuse({ csp: All.opt.csp }));
		}
	});
};

exports.helper = function(mw, settings, request, response) {
	const conf = All.opt.report;
	if (conf.to) {
		response.set('Report-To', JSON.stringify({
			group: "default",
			max_age: 31536000,
			endpoints: [{
				url: conf.to
			}],
			include_subdomains: true
		}));
		response.set('NEL', JSON.stringify({
			report_to: "default",
			max_age: 31536000,
			include_subdomains: true
		}));
	}
	let xss = '1; mode=block';
	if (conf.xpp) {
		xss += `; report=${conf.xpp}`;
	}
	response.set('X-Xss-Protection', xss);
};

