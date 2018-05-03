var inspector = require('url-inspector');
var URL = require('url');

exports = module.exports = function(opt) {
	if (!opt.inspector) opt.inspector = {};
	return {
		name: 'inspector'
	};
};

exports.get = function({url, local}) {
	return new Promise(function(resolve, reject) {
		try {
			inspector(url, Object.assign({}, All.opt.inspector, {
				nofavicon: local,
				file: local
			}), function(err, result) {
				if (err) reject(err);
				else resolve(result);
			});
		} catch(err) {
			reject(err);
		}
	}).catch(function(err) {
		if (typeof err == 'number') err = new HttpError[err]("Inspector failure");
		throw err;
	})
	.then(filterResult)
	.then(preview);
};

function filterResult(result) {
	var obj = {meta:{}};
	['mime', 'url', 'type', 'title', 'icon', 'site']
	.forEach(function(key) {
		if (result[key] !== undefined) obj[key] = result[key];
	});
	if (obj.icon == "data:/,") delete obj.icon;
	if (result.url) obj.pathname = URL.parse(result.url).pathname;
	var meta = {};
	['width', 'height', 'duration', 'size', 'thumbnail', 'description']
	.forEach(function(key) {
		if (result[key] !== undefined) obj.meta[key] = result[key];
	});
	if (obj.type == "image" && obj.mime != "text/html") {
		if (!obj.meta.thumbnail) obj.meta.thumbnail = obj.url;
		if (!obj.meta.width || !obj.meta.height) throw new HttpError.BadRequest("Bad image.\nCheck it does not embed huge metadata (thumbnail, icc profile, ...).");
	}
	return obj;
}

function preview(obj) {
	var desc = obj.meta.description || '';
	delete obj.meta.description;
	var thumb = obj.meta.thumbnail;
	delete obj.meta.thumbnail;
	if (thumb != null) {
		return All.image.thumbnail(thumb).then(function(datauri) {
			obj.preview = `<img src="${datauri}" alt="${desc}" />`;
		}).catch(function(err) {
			console.error("Error embedding thumbnail", thumb, err);
		}).then(function() {
			return obj;
		});
	}
	if (description != null) {
		obj.preview = description;
	}
	return Promise.resolve(obj);
}
