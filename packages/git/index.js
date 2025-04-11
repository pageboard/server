const xHubSignature = require('x-hub-signature');

module.exports = class GitModule {
	static name = 'git';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (!opts.wkp) {
			opts.wkp = "/.well-known/git";
		}
	}

	siteRoutes(router) {
		router.post(this.opts.wkp, async (req, res, next) => {
			try {
				const body = await res.json();
				const { site } = req;
				const event = req.get('X-Github-Event');
				if (event == "ping") {
					return res.json({});
				}
				if (event != "push") {
					throw new HttpError.BadRequest("Unsupported event");
				}
				const secret = site.data['github-webhook-secret'];
				if (secret) {
					const xHub = new xHubSignature('sha256', secret);
					if (!xHub.verify(req.get('X-Hub-Signature-256'), req.buffer)) {
						throw new HttpError.BadRequest("Bad signature");
					}
				}
				this.github(req, body).catch(err => {
					console.error(err);
				});
			} catch (err) {
				next(err);
			}
		});
	}

	async github(req, payload) {
		const { site } = req;
		const { pusher = {} } = payload;
		const mail = {
			purpose: 'transactional',
			to: [{
				name: pusher.name,
				address: pusher.email
			}]
		};
		try {
			const changed = await req.run('git.decide', getRefs(site.data.dependencies, payload));
			if (!changed) return;
			await req.run('site.save', site.data);
			mail.subject = `Pageboard deployed ${site.id} at version ${site.data.version}`;
			await req.call('cache.invalidate');
			mail.text = Text`
						The version is immediately available at
						${req.$url.href}
					`;

		} catch (err) {
			mail.subject = `Pageboard error deploying ${site.id} at version ${site.data.version}`;
			mail.text = Text`
						An error occurred while deploying from repository:
						${err.message}
					`;
		}
		if (pusher.email) {
			await req.run('mail.to', mail);
		}
	}

	async decide(req, data) {
		// site.data.module: url[#<commit-ish> | #semver:<range>]
		// site.data.version: commit-ish
		const { site } = req;
		const version = site.data.version;
		/*
		const prev = parseRefs(site.data.module);

		if (!prev.url || data.url !== prev.url) {
			throw new HttpError.BadRequest(
				`Site module is not "${data.url}"`
			);
		}

		if (
			data.branch && prev.branch
			&&
			data.branch !== prev.branch
		) {
			throw new HttpError.BadRequest(
				`Site module restricted to branch "${prev.branch}"`
			);
		}

		if (data.version && prev.range) {
			if (semver.satisfies(data.version, prev.range)) {
				site.data.version = data.version;
			} else {
				throw new HttpError.BadRequest(
					`Site module restricted to version "${prev.range}"`
				);
			}
		}

		if (data.commit && site.data.env != "production") {
			if (prev.commit && data.commit !== prev.commit) {
				throw new HttpError.BadRequest(
					`Site module restricted to commit "${prev.commit}"`
				);
			} else {
				site.data.version = data.commit;
			}
		}
		*/
		if (version != site.data.version) {
			return true;
		} else {
			return false;
		}
	}
	static decide = {
		title: 'Decide deployment',
		$private: true,
		$action: 'write',
		properties: {
			url: {
				title: 'Repository',
				type: 'string',
				format: 'singleline',
				nullable: true
			},
			branch: {
				title: 'Branch',
				type: 'string',
				format: 'singleline',
				nullable: true
			},
			commit: {
				title: 'Commit',
				type: 'string',
				format: 'singleline',
				nullable: true
			},
			version: {
				title: 'Version',
				type: 'string',
				format: 'singleline',
				nullable: true
			}
		}
	};
};

function getRefs(dependencies, pay) {
	if (!pay.ref && !pay.head_commit || pay.deleted) return;
	const { groups: {
		tag
	} } = /refs\/tags\/(?<tag>.+)/.exec(pay.ref) ?? { groups: {} };
	const { groups: {
		branch
	} } = /refs\/heads\/(?<branch>.+)/.exec(pay.base_ref || pay.ref) ?? { groups: {} };
	// TODO
	// find a value in the list of dependencies[key].semver that matches a github repository with that full_name
	// check that the branch matches the semver value, if the semver value has a #branch
	// semver is expected to be github:org/name#branch
	// Ignore tags. A hook on a branch means we want deployment, that's all.
	const obj = {
		url: pay.repository.full_name,
		version: tag,
		branch,
		commit: pay.head_commit.id
	};
	return obj;
}
/*
function parseRefs(str) {
	if (!str) return {};
	const [url, spec] = str.split('#');
	const obj = { url	};
	if (spec) {
		if (/^[a-z0-9]{7,}$/.test(spec) || /^v?\d+\.\d+/.test(spec)) {
			obj.commit = spec;
		} else if (spec.startsWith('semver:')) {
			obj.range = semver.validRange(spec.substring(7));
		} else {
			obj.branch = spec;
		}
	}
	return obj;
}
*/
