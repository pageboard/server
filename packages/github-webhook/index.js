const semver = require('semver');
const crypto = require('crypto');

exports = module.exports = function(opt) {
	return {
		name: 'api',
		service: init
	};
};

function init(All) {
	console.info("Setting up /.api/github webhook");
	All.app.post('/.api/github', function(req, res, next) {
		var site = req.site;
		var pusher;
		var version;
		Promise.resolve().then(function() {
			var event = req.get('X-Github-Event');
			if (event == "ping") {
				return res.sendStatus(200);
			}
			if (event != "push") {
				return next(new HttpError.BadRequest("Unsupported event"));
			}

			var secret = site.data['github-webhook-secret'];
			if (secret) {
				var sign = req.get('X-Github-Signature');
				if (sign && sign != signBlob(secret, req._body)) {
					return next(new HttpError.Forbidden("Invalid Signature"));
				}
			}

			var payload = req.body;
			pusher = payload.pusher;
			const mod = parseRefs(site.data.module);

			if (!mod.repo || mod.repo != payload.repository.full_name) {
				return next(new HttpError.BadRequest(`Unknown repository "${payload.repository.full_name}"`));
			}
			var refs = getRefs(payload);
			if (!refs) {
				return next(new HttpError.BadRequest('Ignoring payload without ref'));
			}

			// site.data.module keeps the repository, branch|commit|tag|semver:range that should be installed
			// site.data.version tracks the *actual* successfully installed commit|tag|version
			var msg = 'Nothing to do';
			var stop = false;
			if (mod.branch && refs.branch) {
				if (refs.branch != mod.branch) {
					msg = `Site module restricted to branch "${mod.branch}"`;
					stop = true;
				}
			}
			if (!stop && refs.version) {
				if (mod.range && semver.satisfies(refs.version, mod.range) == false) {
					msg = `Site module restricted to version "${mod.range}"`;
					stop = true;
				} else if (!version) {
					version = refs.version;
				}
			}
			if (!stop && refs.tag) {
				if (mod.tag && refs.tag != mod.tag) {
					msg = `Site module restricted to tag "${mod.tag}"`;
					stop = true;
				} else if (!version) {
					version = refs.tag;
				}
			}
			if (!stop && refs.commit) {
				if (mod.commit && refs.commit != mod.commit) {
					msg = `Site module restricted to commit "${mod.commit}"`;
					stop = true;
				} else if (!version && site.data.env != "production") {
					version = refs.commit;
				}
			}
			if (version != null && !stop) {
				site.data.version = version;
				msg = `Saving version ${version}`;
			}
			res.status(200).send(msg);
		}).then(function() {
			if (version != null) return All.site.save(site).then(function() {
				if (pusher) All.mail.to({
					to: {
						name: pusher.name,
						address: pusher.email
					},
					subject: `Pageboard deployed ${site.data.module} to ${req.site.href}`,
					text: Text`
						The version ${site.data.version} is immediately available at
						${req.site.href}
					`
				});
			});
		}).catch(function(err) {
			if (pusher) All.mail.to({
				to: {
					name: pusher.name,
					address: pusher.email
				},
				subject: `Pageboard error deploying ${site.data.module} to ${req.site.href}`,
				text: Text`
					An error occurred while deploying from repository:
					${err.message}
				`
			});
			else console.error(err);
		});
	});
}

function getRefs(pay) {
	if (!pay.ref && !pay.after || pay.deleted) return;
	const obj = {
		tag: (/refs\/tags\/(.+)/.exec(pay.ref) || []).pop(),
		branch: (/refs\/heads\/(.+)/.exec(pay.base_ref || pay.ref) || []).pop(),
		commit: pay.after
	};
	if (obj.tag) obj.version = semver.clean(obj.tag);
	return obj;
}

function parseRefs(str) {
	const [repo, com] = (str || '').split('#');
	const obj = {
		repo: repo
	};
	if (com) {
		if (/^#[a-z0-9]{8,}$/.test(com)) {
			obj.commit = com;
		} else if (com.startsWith('semver:')) {
			obj.tag = com.substring(7);
			obj.range = semver.validRange(obj.tag);
		} else {
			obj.branch = com;
		}
	}
	return obj;
}

function signBlob(key, blob) {
	return 'sha1=' + crypto.createHmac('sha1', key).update(blob).digest('hex');
}
