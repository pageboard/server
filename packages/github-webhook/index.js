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
			if (mod.branch && refs.branch) {
				if (refs.branch != mod.branch) {
					throw new Error(`Site module restricted to branch "${mod.branch}"`);
				}
			}
			if (refs.version) {
				if (mod.range && semver.satisfies(refs.version, mod.range) == false) {
					throw new Error(`Site module restricted to version "${mod.range}"`);
				} else {
					version = refs.version;
				}
			}
			if (refs.tag) {
				if (mod.tag && refs.tag != mod.tag) {
					throw new Error(`Site module restricted to tag "${mod.tag}"`);
				} else if (!version) {
					version = refs.tag;
				}
			}
			if (refs.commit) {
				if (mod.commit && refs.commit != mod.commit) {
					throw new Error(`Site module restricted to commit "${mod.commit}"`);
				} else if (!version && site.data.env != "production") {
					version = refs.commit;
				}
			}
			res.status(200);
			if (version != null) {
				site.data.version = version;
				res.send(`Saving version ${version}`);
			} else {
				res.send("Nothing to do");
			}
		}).catch(function(err) {
			res.status(400).send(`Deployment refused ${err.message}`);
			throw err;
		}).then(function() {
			if (version != null) return All.site.save(site).then(function() {
				if (pusher) All.mail.to({
					to: {
						name: pusher.name,
						address: pusher.email
					},
					subject: `Pageboard deployed ${site.data.module} ${site.data.version}`,
					text: `The changes are immediately available from\n${req.site.href}`
				});
			});
		}).catch(function(err) {
			console.error(site.id, site.data.module, err);
			if (pusher) All.mail.to({
				to: {
					name: pusher.name,
					address: pusher.email
				},
				subject: `Pageboard error deploying site ${site.data.module}`,
				text: `An error occurred while deploying from repository:
					${err.message}`
			});
		});
	});
}

function getRefs(pay) {
	if (!pay.ref && !pay.after) return;
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
