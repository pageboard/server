exports.any = function(block) {
	var locks = block.lock && block.lock.read;
	if (locks) locks.forEach(function(lock, i) {
		locks[i] = lock.replace(/^user-/, "id-");
	});
	if (block.content) Object.entries(block.content).forEach(function([key, str]) {
		block.content[key] = str
		.replaceAll('<element-query', '<element-template')
		.replaceAll('</element-query>', '</element-template>');
	});
};

exports.site = function(site) {
	if (site.data.ga_tracking_id) {
		site.data.google_tag_manager = site.data.ga_tracking_id;
		delete site.data.ga_tracking_id;
	}
};

exports.notfound = function(block) {
	block.type = "page";
	block.data = Object.assign(block.data || {}, {
		url: '/.well-known/404',
		noindex: true,
		nositemap: true
	});
};

exports.page = function(block) {
	var tr = block.data.transition;
	if (tr) {
		block.data.transition = {
			open: tr.from ? tr.from.replace(/^from-/, 'tr-') : null,
			close: tr.to ? tr.to.replace(/^to-/, 'tr-') : null
		};
	}
};

exports.form = function(block, parent) {
	var data = {};
	var old = block.data;
	var method = old.action && old.action.method || 'get';
	var expr = {};
	if (method == "get") {
		block.type = "query_form";
		if (old.action) {
			if (old.action.type) {
				data.type = old.action.type;
			}
			if (old.action.consts) {
				throw new Error("Cannot convert action.consts for query_form");
			}
			if (old.action.vars) {
				var keys = Object.keys(old.action.vars);
				if (keys.length) console.warn("ignoring form.action.vars ", old);
			}
		}
	} else if (method == "post") {
		block.type = "api_form";
		if (old.action) {
			data.action = {
				method: old.action.call,
				parameters: old.action.consts || {}
			};
			if (data.action.method == "auth.login") {
				data.action.method = "login.send";
				data.action.parameters = {
					grant: "webmaster"
				};
				expr.hidden = "[$query.email|!?|bmagnet:*]";
				expr.redirection = {
					parameters: {
						email: "[$request.email]"
					}
				};
			} else if (old.action.vars) {
				block.expr = {
					action: {
						parameters: old.action.vars
					}
				};
			}
		}
	}
	if (old.redirection) {
		data.redirection = {};
		if (old.redirection.url != null) data.redirection.url = old.redirection.url;
		if (old.redirection.consts != null) data.redirection.parameters = old.redirection.consts;
		if (old.redirection.vars != null) expr.redirection = {
			parameters: old.redirection.vars
		};
	}
	block.data = data;
	if (Object.keys(expr).length) block.expr = expr;
	if (block.content && block.content.form) {
		block.content = {
			"": block.content.form
		};
	}
};

exports.query = function(block) {
	block.type = 'fetch';
	var data = {};
	var old = block.data;
	if (old.query) {
		data.action = {
			method: old.query.call,
			parameters: old.query.consts || {}
		};
		if (old.query.vars) {
			block.expr = {
				action: {
					parameters: {}
				}
			};
			Object.entries(old.query.vars).forEach(function([key, val]) {
				block.expr.action.parameters[key] = `[$query.${val}]`;
			});
		}
	}
	block.data = data;
	if (block.content) {
		block.content = {
			template: (block.content.template) || '' + (block.content.messages || '')
		};
	}
};

exports.form_message = exports.fetch_message = exports.query_message = function(block) {
	block.type = 'message';
};

exports.mail_query = function(block) {
	exports.query(block);
	block.type = 'mail_fetch';
};

exports.query_template = function(block) {
	block.type = 'binding';
	if (block.data.placeholder) delete block.data.placeholder;
};

exports.mail_query_template = function(block) {
	block.type = 'mail_binding';
	if (block.data.placeholder) delete block.data.placeholder;
};
