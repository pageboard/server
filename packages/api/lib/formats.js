module.exports = {
	singleline: /^[^\n\r]*$/,
	pathname: /^(\/@?[\w.-]*)+$/, // for any url
	page: /^((\/[a-zA-Z0-9-]*)+)$|^(\/\.well-known\/\d{3})$/, // only for pages url
	'hex-color': /^(#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?|\w+)$/,
	id: /^[A-Za-z0-9]+$/,
	name: /^[-\w]*$/, // this should be the "type" format
	grant: /^[a-z0-9-]+$/, // this should be the name format !
	lang: /^[a-z]{2}$/,
	ext: /^[a-z]{3,4}$/,
	phone: /^[+(\s.\-/\d)]{5,30}$/
};
