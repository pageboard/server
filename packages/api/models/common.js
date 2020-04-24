const {ref, val, raw, Model, QueryBuilder} = require('objection');

const { isKnexRaw, isKnexQueryBuilder } = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'utils/knexUtils'
	)
);

const { isObject } = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'utils/objectUtils'
	)
);

const UpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
).UpdateOperation;

const InstanceUpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/InstanceUpdateOperation'
	)
).InstanceUpdateOperation;

exports.Model = class CommonModel extends Model {
	$query(trx) {
		if (this.trx && !trx) {
			console.trace("transactions should be passed explicitely");
			trx = this.trx;
		}
		return super.$query(trx).patchObjectOperationFactory(() => {
			return new InstancePatchObjectOperation('patch', {
				instance: this,
				modelOptions: { patch: true }
			});
		});
	}

	$relatedQuery(what, trx) {
		if (this.trx && !trx) {
			console.trace("transactions should be passed explicitely");
			trx = this.trx;
		}
		return super.$relatedQuery(what, trx);
	}

	get $model() {
		return this.constructor;
	}

	$ref(str) {
		return ref(str);
	}

	$val(str) {
		return val(str);
	}

	$raw(str) {
		return raw(str);
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
	selectWithout(...args) {
		const model = this.modelClass();
		const table = this.tableRefFor(model);
		const list = [];
		model.columns.forEach((col) => {
			if (args.includes(col) == false) list.push(`${table}.${col}`);
		});
		return super.select(...list);
	}
	select(...args) {
		if (args.length == 0) {
			const model = this.modelClass();
			const table = this.tableRefFor(model);
			args = model.columns.map(col => `${table}.${col}`);
		}
		return super.select(...args);
	}
	patchObjectOperationFactory(factory) {
		this._patchObjectOperationFactory = factory;
		return this;
	}
	whereJsonText(a, ...args) {
		args.unshift(ref(a).castText());
		return this.where(...args);
	}
	patchObject(obj) {
		const patchObjectOperation = this._patchObjectOperationFactory();
		obj = Object.assign({}, obj);
		const table = this.tableRefFor(this.modelClass());
		if (table == "block") {
			const type = patchObjectOperation.instance && patchObjectOperation.instance.type;
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
		// TODO site.$relatedQuery means this._relatedQueryFor == site
		const table = alias || this.tableRefFor(this.modelClass());
		const refs = asPaths(obj, {}, table, true, schema);
		Object.keys(refs).forEach(function(k) {
			const cond = refs[k];
			const refk = ref(k);
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
			} else if (typeof cond == "object" && cond.op == "end") {
				this.where(refk.castText(), "like", '%' + cond.val);
			} else if (typeof cond == "object" && cond.op == "start") {
				this.where(refk.castText(), "like", cond.val + '%');
			} else if (typeof cond == "object" && cond.op == "in") {
				this.whereRaw('?? @> ?::jsonb', [refk, JSON.stringify(cond.val)]);
			} else if (typeof cond =="object" && cond.range == "numeric") {
				this.whereRaw('?? BETWEEN ? AND ?', [
					refk, cond.start, cond.end
				]);
			} else {
				this.where(refk.castText(), cond);
			}
		}, this);
		return this;
	}
	clone() {
		const builder = super.clone();
		builder._patchObjectOperationFactory = this._patchObjectOperationFactory;
		return builder;
	}
};

function asPaths(obj, ret, pre, first, schema) {
	if (!schema) schema = {};
	const props = schema.properties || {};
	Object.keys(obj).forEach(function(str) {
		let val = obj[str];
		const [key, op] = str.split(':');
		const schem = props[key] || {};
		let cur;
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
			if (val && typeof val == "string" && schem.type == "string" && (schem.format == "date-time" || schem.format == "date")) {
				try { val = dateRange(val); } catch(err) { /**/ }
			} else if (schem.type == "boolean" && typeof val != "boolean") {
				if (val == "false" || val == 0 || !val) val = false;
				else val = true;
			} else if (["integer", "number"].includes(schem.type) && typeof val == "string" && val.includes("~")) {
				val = numericRange(val, schem.type);
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

function dateRange(val) {
	const start = new Date(val);
	const end = new Date(start);
	const parts = val.split('-');
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

function numericRange(val, type) {
	const [start, end] = val.split('~').map((n) => (type == "integer" ? parseInt : parseFloat)(n));
	return {
		range: "numeric",
		start: start,
		end: end
	};
}

function deepAssign(model, obj) {
	Object.keys(obj).forEach(function(key) {
		const val = obj[key];
		const src = model[key];
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
				delete this.model[key];
			} else {
				convertedJson[key] = val;
			}
		}

		return convertedJson;
	}
}

class InstancePatchObjectOperation extends InstanceUpdateOperation {
	async onAfter2(builder, result) {
		const clone = this.instance.$clone();
		result = await super.onAfter2(builder, result);

		if (!isObject(result)) {
			deepAssign(clone, this.model);
			this.instance.$set(clone);
		}
		return result;
	}
}

InstancePatchObjectOperation.prototype.onBuildKnex = PatchObjectOperation.prototype.onBuildKnex;
InstancePatchObjectOperation.prototype.convertFieldExpressionsToRaw = PatchObjectOperation.prototype.convertFieldExpressionsToRaw;

