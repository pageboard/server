const semver = require('semver');
const bodyParser = require.lazy('body-parser');
const xHub = require.lazy('x-hub-signature-middleware');

module.exports = class GitModule {
	static name = 'git';

	constructor(app, opts) {
		this.opts = opts;
	}
	apiRoutes(app, server) {
		server.post('/.api/github', bodyParser.json({
			verify: xHub.extractRawBody
		}), (req, res, next) => {
			const { site } = req;
			const event = req.get('X-Github-Event');
			if (event == "ping") {
				return res.sendStatus(200);
			}
			if (event != "push") {
				return next(new HttpError.BadRequest("Unsupported event"));
			}
			const secret = site.data['github-webhook-secret'];
			if (secret) {
				xHub.xHubSignatureMiddleware({
					algorithm: 'sha256',
					header: 'X-Hub-Signature-256',
					secret,
					require: true
				})(req, res, next);
			} else {
				next();
			}
		}, req => this.#deploy(req, req.body));
	}

	async #deploy(req, payload) {
		const { site } = req;
		const mail = {
			purpose: 'transactional',
			to: [{
				name: payload.pusher.name,
				address: payload.pusher.email
			}]
		};
		try {
			const changed = await req.run('git.save', getRefs(payload));
			if (!changed) return;
			await req.run('site.save', site);
			mail.subject = `Pageboard deployed ${site.id} at version ${site.data.version}`;
			mail.text = Text`
						The version is immediately available at
						${site.url.href}
					`;

		} catch (err) {
			mail.subject = `Pageboard error deploying ${site.id} at version ${site.data.version}`;
			mail.text = Text`
						An error occurred while deploying from repository:
						${err.message}
					`;
		}
		await req.run('mail.to', mail);
	}

	async save(req, data) {
		// site.data.module: url[#<commit-ish> | #semver:<range>]
		// site.data.version: commit-ish
		const { site } = req;
		const version = site.data.version;
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
		if (version != site.data.version) {
			await req.run('site.save', site);
			return true;
		} else {
			return false;
		}
	}
	static deploy = {
		$action: 'write',
		properties: {
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

function getRefs(pay) {
	if (!pay.ref && !pay.head_commit || pay.deleted) return;
	const { groups: {
		tag
	} } = /refs\/tags\/(?<tag>.+)/.exec(pay.ref) ?? { groups: {} };
	const { groups: {
		branch
	} } = /refs\/heads\/(?<branch>.+)/.exec(pay.base_ref || pay.ref) ?? { groups: {} };
	const obj = {
		url: pay.repository.full_name,
		version: tag ? semver.clean(tag) : undefined,
		branch,
		commit: pay.head_commit.id
	};
	return obj;
}

function parseRefs(str) {
	if (!str) return {};
	const [url, spec] = str.split('#');
	const obj = { url	};
	if (spec) {
		if (/^[a-z0-9]{8,}$/.test(spec) || /^v?\d+\.\d+/.test(spec)) {
			obj.commit = spec;
		} else if (spec.startsWith('semver:')) {
			obj.range = semver.validRange(spec.substring(7));
		} else {
			obj.branch = spec;
		}
	}
	return obj;
}