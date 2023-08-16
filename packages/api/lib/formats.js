module.exports = {
	singleline: /^[^\n\r]*$/,
	pathname: /^(\/[\w.-]*)+$/,
	'hex-color': /^(#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?|\w+)$/,
	page: /^((\/[a-zA-Z0-9-]*)+)$|^(\/\.well-known\/\d{3})$/,
	id: /^[A-Za-z0-9]+$/,
	name: /^\w*$/, // this should be the "type" format
	grant: /^[a-z0-9-]+$/, // this should be the name format !
	lang: /^([a-zA-Z]+-?)+$/
};
