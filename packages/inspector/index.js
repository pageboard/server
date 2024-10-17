let Inspector;
const URL = require('url');

exports = module.exports = function(opt) {
	if (!opt.inspector) opt.inspector = {};
	return {
		name: 'inspector'
	};
};

exports.get = async function({url, local}) {
	Inspector ||= (await import('url-inspector')).default;
	const inspector = new Inspector(Object.assign({}, All.opt.inspector, {
		nofavicon: local,
		file: local
	}));
	return inspector.look(url).then(filterResult).then(preview);
};

function filterResult(result) {
	const obj = {meta:{}};
	['mime', 'url', 'type', 'title', 'icon', 'site']
		.forEach((key) => {
			if (result[key] !== undefined) obj[key] = result[key];
		});
	if (obj.icon == "data:/,") delete obj.icon;
	if (result.url) obj.pathname = URL.parse(result.url).pathname;
	['width', 'height', 'duration', 'size', 'thumbnail', 'description']
		.forEach((key) => {
			if (result[key] !== undefined) obj.meta[key] = result[key];
		});
	if (obj.type == "image" && obj.mime != "text/html") {
		if (!obj.meta.thumbnail) obj.meta.thumbnail = obj.url;
		if (!obj.meta.width || !obj.meta.height) throw new HttpError.BadRequest("Bad image.\nCheck it does not embed huge metadata (thumbnail, icc profile, ...).");
		obj.meta.width = Math.round(obj.meta.width);
		obj.meta.height = Math.round(obj.meta.height);
	}
	return obj;
}

function preview(obj) {
	const desc = obj.meta.description || '';
	delete obj.meta.description;
	const thumb = obj.meta.thumbnail;
	delete obj.meta.thumbnail;
	if (thumb != null) {
		return All.image.thumbnail(thumb).then((datauri) => {
			obj.preview = `<img src="${datauri}" alt="${desc}" />`;
		}).catch((err) => {
			console.error("Error embedding thumbnail", thumb, err);
		}).then(() => {
			return obj;
		});
	}
	if (desc) {
		obj.preview = desc;
	}
	return Promise.resolve(obj);
}
