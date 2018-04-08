var objection = require('objection');
var ref = objection.ref;
var QueryBuilder = objection.QueryBuilder;

exports.CommonQueryBuilder = class CommonQueryBuilder extends QueryBuilder {
	whereJsonText(a) {
		var args = Array.from(arguments).slice(1);
		args.unshift(ref(a).castText());
		return this.where.apply(this, args);
	}
	patchObject(obj) {
		var refs = asPaths(obj, {}, "", true);
		this.skipUndefined();
		this.addOperation(this._patchOperationFactory(this), refs);
		return this;
	}
	whereObject(obj) {
		var table = this.tableRefFor(this.modelClass());
		var refs = asPaths(obj, {}, table + '.', true);
		for (var k in refs) {
			this.where(ref(k).castText(), Array.isArray(refs[k]) ? 'IN' : '=', refs[k]);
		}
		return this;
	}
};

function asPaths(obj, ret, pre, first) {
	Object.keys(obj).forEach(function(key) {
		var val = obj[key];
		var cur = `${pre || ""}${key}`;
		if (Array.isArray(val) || typeof val != "object") {
			ret[cur] = val;
		} else if (typeof val == "object") {
			asPaths(val, ret, cur + (first ? ':' : '.'));
		}
	});
	return ret;
}

