var crypto = require('crypto');

exports = module.exports = function(opt) {
	return {
		name: 'api',
		service: init
	};
};

function init(All) {
	var opt = All.opt;
	console.info("Setting up /.api/github webhook");
	All.app.post('/.api/github', function(req, res, next) {
		var site = req.site;
		var save = false;
		Promise.resolve().then(function() {
			var event = req.get('X-Github-Event');
			if (event == "ping") {
				return res.sendStatus(200);
			}
			if (event != "push" && event != "create") {
				return next(new HttpError.BadRequest("Unsupported event"));
			}

			var secret = site.data['github-webhook-secret'];
			if (secret) {
				var sign = req.get('X-Github-Signature');
				var delivery = req.get('X-Github-Delivery');
				if (sign && sign != signBlob(secret, req._body)) {
					throw new HttpError.Forbidden("Invalid Signature");
				}
			}

			var payload = req.body;
			var module = site.data.module;
			var version;
			if (module && module == payload.repository.full_name) {
				var ref = payload.ref;
				if (ref && ref.startsWith('refs/tags/')) {
					version = ref.substring('refs/tags/'.length);
				} else if (site.data.env != "production") {
					version = payload.after;
				}
				if (version) {
					site.data.version = version;
					save = true;
				} else {
					console.warn("Nothing to deploy", site.data.env, event, ref);
				}
			} else {
				throw new HttpError.BadRequest(`Unknown module "${payload.repository.full_name}"`);
			}
			res.status(200);
			if (save) res.send(`Saving version ${version}`);
			else res.send('Nothing to do');
		}).catch(next).then(function() {
			if (save) return All.site.save(site).catch(function(err) {
				console.error("Could not deploy site", site.data.version, err);
			});
		});
	});
}

function signBlob(key, blob) {
	return 'sha1=' + crypto.createHmac('sha1', key).update(blob).digest('hex');
}

