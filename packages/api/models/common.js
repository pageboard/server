var objection = require('objection');
var DbErrors = require('objection-db-errors').DbErrors;
var ref = objection.ref;
var Model = objection.Model;
var QueryBuilder = objection.QueryBuilder;

const { isKnexRaw, isKnexQueryBuilder } = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'utils/knexUtils'
	)
);

var UpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
).UpdateOperation;

var InstanceUpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/InstanceUpdateOperation'
	)
).InstanceUpdateOperation;

exports.Model = class CommonModel extends DbErrors(Model) {
	$query(trx) {
		if (this.trx && !trx) trx = this.trx;
		return super.$query(trx).patchObjectOperationFactory(() => {
			return new InstancePatchObjectOperation('patch', {
				instance: this,
				modelOptions: { patch: true }
			});
		});
	}

	$relatedQuery(what, trx) {
		if (this.trx && !trx) trx = this.trx;
		return super.$relatedQuery(what, trx);
	}

	get $model() {
		return this.constructor;
	}

	$ref(str) {
		return objection.ref(str);
	}

	$lit(str) {
		return objection.lit(str);
	}

	$raw(str) {
		return objection.raw(str);
	}

	$formatJson(json) {
		let superJson = super.$formatJson(json);
		delete superJson._id;
		return superJson;
	}
};

exports.QueryBuilder = class CommonQueryBuilder extends QueryBuilder {
	constructor(modelClass) {
		super(modelClass);
		this._patchObjectOperationFactory = function patchObjectOperationFactory() {
			return new PatchObjectOperation('patch', {
				modelOptions: { patch: true }
			});
		};
	}
	select(...args) {
		if (args.length == 0) {
			var model = this.modelClass();
			var table = this.tableRefFor(model);
			args = model.columns.map(col => `${table}.${col}`);
		}
		return super.select(args);
	}
	patchObjectOperationFactory(factory) {
		this._patchObjectOperationFactory = factory;
		return this;
	}
	whereJsonText(a) {
		var args = Array.from(arguments).slice(1);
		args.unshift(ref(a).castText());
		return this.where.apply(this, args);
	}
	patchObject(obj) {
		var patchObjectOperation = this._patchObjectOperationFactory();
		obj = Object.assign({}, obj);
		var table = this.tableRefFor(this.modelClass());
		if (table == "block") {
			var type = patchObjectOperation.instance && patchObjectOperation.instance.type;
			if (type) {
				if (obj.type) {
					if (obj.type != type) throw new Error("Cannot patch object with different type");
				} else {
					obj.type = type;
				}
			} else if (!obj.type) {
				throw new Error("Cannot patch block without type");
			}
		}
		this.skipUndefined();
		this.addOperation(patchObjectOperation, [obj]);
		return this;
	}
	whereObject(obj, schema, alias) {
		var table = alias || this.tableRefFor(this.modelClass());
		var refs = asPaths(obj, {}, table, true, schema);
		Object.keys(refs).forEach(function(k) {
			var cond = refs[k];
			var refk = ref(k);
			if (cond == null) {
				this.whereNull(refk);
			} else if (Array.isArray(cond)) {
				this.where(refk.castText(), 'IN', cond);
			} else if (typeof cond == "object" && cond.range == "date") {
				this.whereRaw(`'[${cond.start}, ${cond.end})'::daterange @> ??`, [
					refk.castTo('date')
				]);
			} else if (typeof cond == "object" && cond.op == "not") {
				this.whereNot(refk.castText(), cond.val);
			} else {
				this.where(refk.castText(), cond);
			}
		}, this);
		return this;
	}
	clone() {
		var builder = super.clone();
		builder._patchObjectOperationFactory = this._patchObjectOperationFactory;
		return builder;
	}
};

function asPaths(obj, ret, pre, first, schema) {
	if (!schema) schema = {};
	var props = schema.properties || {};
	Object.keys(obj).forEach(function(str) {
		var val = obj[str];
		var [key, op] = str.split(':');
		var schem = props[key] || {};
		var cur;
		if (pre) {
			if (first) {
				cur = `${pre}.${key}`;
			} else if (pre.endsWith(':')) {
				cur = `${pre}${key}`;
			} else {
				cur = `${pre}[${key}]`;
			}
		} else {
			cur = key;
		}
		if (Array.isArray(val) || val == null || typeof val != "object") {
			if (val && typeof val == "string" && schem.type == "string" && schem.format == "date-time") {
				try { val = partialDate(val); } catch(err) { /**/ }
			} else if (schem.type == "boolean" && typeof val != "boolean") {
				if (val == "false" || val == 0 || !val) val = false;
				else val = true;
			}
			if (op) ret[cur] = {
				op: op,
				val: val
			};
			else ret[cur] = val;
		} else if (typeof val == "object") {
			asPaths(val, ret, cur + (first ? ':' : ''), false, schem);
		}
	});
	return ret;
}

function partialDate(val) {
	var start = new Date(val);
	var end = new Date(start);
	var parts = val.split('-');
	if (parts.length == 1) {
		end.setFullYear(end.getFullYear() + 1);
	} else if (parts.length == 2) {
		end.setMonth(end.getMonth() + 1);
	} else if (parts.length == 3) {
		end.setDate(end.getDate() + 1);
	}

	return {
		range: "date",
		start: start.toISOString(),
		end: end.toISOString()
	};
}

function deepAssign(model, obj) {
	Object.keys(obj).forEach(function(key) {
		var val = obj[key];
		var src = model[key];
		if (val == null || typeof val != "object" || src == null) {
			model[key] = val;
		} else {
			deepAssign(src, val);
		}
	});
}


class PatchObjectOperation extends UpdateOperation {
	onBuildKnex(knexBuilder, builder) {
		const json = this.model.$toDatabaseJson(builder.knex());
		const jsonPaths = asPaths(json, {}, "", true);
		const convertedJson = this.convertFieldExpressionsToRaw(builder, jsonPaths);

		knexBuilder.update(convertedJson);
	}
	convertFieldExpressionsToRaw(builder, json) {
		const knex = builder.knex();
		const convertedJson = {};
		const keys = Object.keys(json);

		for (let i = 0, l = keys.length; i < l; ++i) {
			let key = keys[i];
			let val = json[key];

			if (key.indexOf(':') > -1) {
				// 'col:attr' : ref('other:lol') is transformed to
				// "col" : raw(`jsonb_set("col", '{attr}', to_jsonb("other"#>'{lol}'), true)`)

				let parsed = ref(key);
				let jsonRefs = '{' + parsed._parsedExpr.access.map(it => it.ref).join(',') + '}';
				let valuePlaceholder = '?';

				if (isKnexQueryBuilder(val) || isKnexRaw(val)) {
					valuePlaceholder = 'to_jsonb(?)';
				} else {
					val = JSON.stringify(val);
				}

				convertedJson[parsed.column] = knex.raw(
					`jsonb_set_recursive(??, '${jsonRefs}', ${valuePlaceholder})`,
					[convertedJson[parsed.column] || parsed.column, val]
				);
			} else {
				convertedJson[key] = val;
			}
		}

		return convertedJson;
	}
}

class InstancePatchObjectOperation extends InstanceUpdateOperation {
	onAfter2(builder, result) {
		const clone = this.instance.$clone();
		result = super.onAfter2(builder, result);
		if (!result || typeof result != "object") {
			this.instance.$set(clone);
			deepAssign(this.instance, this.model);
		}
		return result;
	}
}

InstancePatchObjectOperation.prototype.onBuildKnex = PatchObjectOperation.prototype.onBuildKnex;
InstancePatchObjectOperation.prototype.convertFieldExpressionsToRaw = PatchObjectOperation.prototype.convertFieldExpressionsToRaw;

