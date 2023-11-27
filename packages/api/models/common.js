const { ref, val, raw, fn: fun, Model, QueryBuilder } = require('objection');
const Duration = require('iso8601-duration');
const Path = require('node:path');

const { isKnexRaw, isKnexQueryBuilder } = require(
	Path.join(
		require.resolve('objection'),
		'..',
		'utils/knexUtils'
	)
);

const { isObject } = require(
	Path.join(
		require.resolve('objection'),
		'..',
		'utils/objectUtils'
	)
);

const { UpdateOperation } = require(
	Path.join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
);

const { InstanceUpdateOperation } = require(
	Path.join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/InstanceUpdateOperation'
	)
);

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

class PatchObjectOperation extends UpdateOperation {
	onBuildKnex(knexBuilder, builder) {
		// this works only if $formatDatabaseJson does not stringify objects
		const json = this.model.$toDatabaseJson(builder);
		const jsonPaths = asPaths(json, {}, "", true);
		const convertedJson = convertFieldExpressionsToRaw(
			builder, this.model, jsonPaths
		);
		return knexBuilder.update(convertedJson);
	}
}

InstancePatchObjectOperation.prototype.onBuildKnex = PatchObjectOperation.prototype.onBuildKnex;



exports.Model = class CommonModel extends Model {
	$query(trx) {
		if (this.trx && !trx) {
			// eslint-disable-next-line no-console
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
			// eslint-disable-next-line no-console
			console.trace("transactions should be passed explicitely");
			trx = this.trx;
		}
		return super.$relatedQuery(what, trx);
	}

	async $beforeUpdate(opts, q) {
		await super.$beforeUpdate(opts, q);
		this.updated_at = new Date().toISOString();
	}

	async $beforeInsert(q) {
		await super.$beforeInsert(q);
		if (!this.updated_at) this.updated_at = new Date().toISOString();
	}

	$formatJson(json) {
		const superJson = super.$formatJson(json);
		delete superJson._id;
		return superJson;
	}

	$formatDatabaseJson(json) {
		// objection 3 stringifies json columns, but
		// patchObject can only work on unstringified json
		// and pg driver serializes them anyway.
		return json;
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
	get fun() {
		return fun;
	}
	get ref() {
		return ref;
	}
	get val() {
		return val;
	}
	get raw() {
		return raw;
	}
	selectWithout(...args) {
		const model = this.modelClass();
		const table = this.tableRefFor(model);
		const list = [];
		model.columns.forEach(col => {
			if (args.includes(col) == false) list.push(`${table}.${col}`);
		});
		return super.select(list);
	}
	columns({ table, lang, content } = {}) {
		const model = this.modelClass();
		if (!table) table = this.tableRefFor(model);
		const cols = [];
		for (const col of model.columns) {
			const rcol = ref(col).from(table);
			if (col == 'content') {
				if (!content) continue;
				if (lang) {
					cols.push(
						raw(`(block_get_content(:id:, :lang, :content)).*`, {
							id: ref('_id').from(table),
							lang,
							content: content === true ? null : content
						})
					);
					continue;
				} else if (typeof content == "string") {
					cols.push(
						raw(`jsonb_build_object(:content, content[:content:]) AS content`, {
							content
						})
					);
					continue;
				}
			}
			cols.push(rcol);
		}
		return super.select(cols);
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
		obj = { ...obj };
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
		this.addOperation(patchObjectOperation, [obj]);
		return this;
	}
	whereObject(obj, types, alias) {
		const mClass = this.modelClass();
		if (types == null) types = [];
		else if (typeof types == "string") types = [types];

		const schemas = types.map(type => mClass.schema(type));
		const table = alias || this.tableRefFor(mClass);
		const refs = asPaths(obj, {}, table, true, schemas);

		for (const [k, cond] of Object.entries(refs)) {
			// FIXME
			// https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING
			// The default GIN operator class for jsonb supports queries with the key-exists operators ?, ?| and ?&, the containment operator @>, and the jsonpath match operators @? and @@.
			whereCond(this, k, cond);
		}
		return this;
	}
	clone() {
		const builder = super.clone();
		builder._patchObjectOperationFactory = this._patchObjectOperationFactory;
		return builder;
	}
};

function getCast(val) {
	if (val == null) return null;
	const type = typeof val;
	if (type == "boolean") {
		return "boolean";
	} else if (type == "number") {
		const p = val.toString();
		if (val === Number.parseInt(p)) return "integer";
		else return "float";
	} else {
		return "text";
	}
}

function whereCondObject(q, refk, cond) {
	const comps = {
		lt: '<',
		lte: '<=',
		gt: '>',
		gte: '>='
	};
	if (cond.op in comps) {
		if (cond.val instanceof Date) {
			// DEAD CODE because asPaths doesn't return such a cond
			q.where(refk.castTo('date'), comps[cond.op], cond.val);
		} else if (typeof cond.val == "number") {
			q.where(refk.castFloat(), comps[cond.op], cond.val);
		} else {
			q.where(refk.castText(), comps[cond.op], cond.val);
		}
	} else if (cond.range == "date") {
		if (cond.names) {
			// slot intersection
			const start = `${refk.expression}.${cond.names[0]}`;
			const end = `${refk.expression}.${cond.names[1]}`;
			q.whereNotNull(ref(start)); // TODO optional start
			q.whereNotNull(ref(end)); // TODO optional end
			if (cond.start == cond.end) {
				q.whereRaw(`(daterange(:start:, :end:) @> :at OR (:start: = :at AND :end: = :at))`, {
					start: ref(start).castTo('date'),
					end: ref(end).castTo('date'),
					at: val(cond.start).castTo('date')
				});
			} else {
				q.whereRaw(`daterange(:from, :to) && daterange(:start:, :end:)`, {
					start: ref(start).castTo('date'),
					end: ref(end).castTo('date'),
					from: val(cond.start).castTo('date'),
					to: val(cond.end).castTo('date')
				});
			}
		} else {
			q.whereNotNull(refk);
			if (cond.start == cond.end) {
				q.whereIn(refk.castTo('date'), [
					val(cond.start).castTo('date'),
					val(cond.end).castTo('date')
				]);
			} else {
				q.whereRaw(`(daterange(:from, :to) @> :at: OR (:at: = :from AND :at: = :to))`, {
					from: val(cond.start).castTo('date'),
					to: val(cond.end).castTo('date'),
					at: refk.castTo('date')
				});
			}
		}
	} else if (cond.op == "not") {
		q.whereNot(refk.castText(), cond.val);
	} else if (cond.op == "end") {
		q.where(refk.castText(), "ilike", '%' + cond.val);
	} else if (cond.op == "start") {
		q.where(refk.castText(), "ilike", cond.val + '%');
	} else if (cond.op == "has") {
		if (cond.type == "string" && typeof cond.val == "string") {
			// ref is a string and it contains that value
			q.where(refk.castText(), "ilike", '%' + cond.val + '%');
		} else {
			// ref is a json text or array, and it intersects any of the values
			const val = typeof cond.val == "string" ? [cond.val] : cond.val;
			if (val != null) q.whereRaw('?? \\?| ?', [refk, val]);
		}
	} else if (cond.op == "in") {
		if (cond.type == "string" && typeof cond.val == "string") {
			// ref is a string and it is contained in that value
			q.whereRaw("? ilike '%' || ?? || '%'", [cond.val, refk.castText()]);
		} else {
			// ref is a json string, and it is in the values
			const val = typeof cond.val == "string" ? [cond.val] : cond.val;
			if (val != null) q.whereRaw('?? \\?& ?', [refk, val]);
		}
	} else if (cond.range == "numeric") {
		if (cond.names) {
			const start = `${refk.expression}.${cond.names[0]}`;
			const end = `${refk.expression}.${cond.names[1]}`;
			q.whereNotNull(ref(start)); // TODO optional start
			q.whereNotNull(ref(end)); // TODO optional end
			if (cond.start == cond.end) {
				q.whereRaw(`(numrange(:start:, :end:) @> :at OR (:start: = :at AND :end: = :at))`, {
					start: ref(start).castTo('numeric'),
					end: ref(end).castTo('numeric'),
					at: val(cond.start).castTo('numeric')
				});
			} else {
				q.whereRaw(`numrange(:from, :to) && numrange(:start:, :end:)`, {
					start: ref(start).castTo('numeric'),
					end: ref(end).castTo('numeric'),
					from: val(cond.start).castTo('numeric'),
					to: val(cond.end).castTo('numeric')
				});
			}
		} else {
			q.whereRaw(':col: <@ numrange(:from, :to)', {
				col: refk,
				from: val(cond.start).castTo('numeric'),
				to: val(cond.end).castTo('numeric')
			});
		}
	} else {
		throw new HttpError.BadRequest(
			`Bad condition operator ${JSON.stringify(cond)}`
		);
	}
}

function whereCond(q, key, value) {
	const refk = ref(key);
	if (value == null) {
		return q.whereNull(refk);
	}
	if (Array.isArray(value)) {
		q.where(q => {
			const byType = new Map();
			for (const x of value) {
				if (x == null) {
					byType.set('null', true);
				} else {
					const xtype = typeof x;
					if (!byType.has(xtype)) byType.set(xtype, new Set());
					byType.get(xtype).add(x);
				}
			}
			for (const [type, set] of byType) {
				if (type == 'null') q.orWhereNull(refk);
				else q.orWhere(refk.castTo(getCast(type)), 'IN', Array.from(set));
			}
		});
		return q;
	}

	if (typeof value == "object") {
		whereCondObject(q, refk, value);
	} else {
		q.where(refk.castTo(getCast(value)), value);
	}
}

function asPaths(obj, ret, pre, first, schemas) {
	const dateTimes = ["date-time", "date"];
	Object.keys(obj).forEach(str => {
		let val = obj[str];
		const [key, op] = str.split(':');
		if (op != null) {
			delete obj[str];
			obj[key] = val;
		}
		const schem = schemas?.find(
			item => item.properties?.[key]
		)?.properties?.[key];
		if (!schem && schemas?.length) {
			// refuse extra conditions
			delete obj[key];
			return;
		}
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
		const curProps = schem?.properties ?? {};
		const curType = schem?.type;
		const propKeys = Object.keys(curProps);
		if (
			val && (
				typeof val == "string"
				|| typeof val == "object" && val.start && val.end
				|| Array.isArray(val)
			)
			&& curType == "object" && propKeys.length == 2
			&& (
				dateTimes.includes(curProps[propKeys[0]].format)
				&& dateTimes.includes(curProps[propKeys[1]].format)
				|| curProps[propKeys[0]].type == "integer"
				&& curProps[propKeys[1]].type == "integer"
			)
		) {
			// we have a date or numeric slot
			let range;
			if (curProps[propKeys[0]].type == "integer" && curProps[propKeys[1]].type == "integer") {
				range = numericRange(val);
			} else {
				range = dateRange(val);
			}
			if (range) {
				range.names = propKeys;
				ret[cur] = range;
			} else if (op) ret[cur] = {
				op: op,
				val: val
			};
			else ret[cur] = val;
		} else if (Array.isArray(val) || val == null || typeof val != "object") {
			if (val && curType == "string" && dateTimes.includes(schem.format)) {
				if (op) {
					val = new Date(val);
				} else {
					const range = dateRange(val);
					if (range) {
						val = range;
					}
				}
			} else if (curType == "boolean" && typeof val != "boolean") {
				if (!val || val == "false") {
					if (schem.default == false) {
						val = [false, null];
					} else {
						val = false;
					}
				} else {
					val = true;
				}
			} else if (["integer", "number"].includes(curType) && typeof val == "string" && (val.includes("~") || val.includes("⩽"))) {
				val = numericRange(val, curType);
			}
			if (op) ret[cur] = {
				type: curType,
				op,
				val
			};
			else ret[cur] = val;
		} else if (typeof val == "object") {
			asPaths(val, ret, cur + (first ? ':' : ''), false, [schem]);
		}
	});
	return ret;
}

function dateRange(val) {
	let start, end;
	if (typeof val == "string") {
		[start, end] = partialDateRange(val);
	} else if (Array.isArray(val) && val.length == 2) {
		let start = new Date(val[0]);
		let end = new Date(val[1]);
		let startTime = start.getTime();
		let endTime = end.getTime();
		if (Number.isNaN(startTime) && Number.isNaN(endTime)) return;
		if (Number.isNaN(endTime)) {
			end = start;
			endTime = startTime;
		} else if (Number.isNaN(startTime)) {
			start = end;
			startTime = endTime;
		}
		if (startTime == endTime) end = start;
		else if (startTime > endTime) [start, end] = [end, start];
	}
	return {
		range: 'date', start, end
	};
}

function partialDateRange(val) {
	const parts = val.split('P');
	const start = new Date(parts[0]);
	if (Number.isNaN(start.getTime())) return;
	let end;
	if (parts.length == 1) {
		end = new Date(start);
		const parts = val.split('-');
		if (parts.length == 1) {
			end.setFullYear(end.getFullYear() + 1);
		} else if (parts.length == 2) {
			end.setMonth(end.getMonth() + 1);
		} else if (parts.length == 3) {
			end.setDate(end.getDate() + 1);
		}
	} else if (parts.length == 2) {
		end = Duration.end(Duration.parse('P' + parts[1]), start);
	}
	if (Number.isNaN(end.getTime())) end = start;
	return [start, end];
}

function numericRange(val, type) {
	const [start, end] = val.split(/~|⩽/).map(n => {
		return (type == "integer" ? parseInt : parseFloat)(n);
	});

	return {
		range: "numeric",
		start: start,
		end: end ?? start
	};
}

function deepAssign(model, obj) {
	Object.keys(obj).forEach(key => {
		const val = obj[key];
		const src = model[key];
		if (val == null || typeof val != "object" || src == null) {
			model[key] = val;
		} else {
			deepAssign(src, val);
		}
	});
}

function convertFieldExpressionsToRaw(builder, model, json) {
	const knex = builder.knex();
	const convertedJson = {};

	for (const key of Object.keys(json)) {
		let value = json[key];

		if (key.indexOf(':') > -1) {
			// 'col:attr' : ref('other:lol') is transformed to
			// "col" : raw(`jsonb_set("col", '{attr}', to_jsonb("other"#>'{lol}'), true)`)

			const parsed = ref(key);
			const jsonRefs = '{'
				+ parsed.parsedExpr.access.map(it => it.ref).join(',')
				+ '}';
			let valuePlaceholder = '?';

			if (isKnexQueryBuilder(value) || isKnexRaw(value)) {
				valuePlaceholder = 'to_jsonb(?)';
			} else {
				value = JSON.stringify(value);
			}

			convertedJson[
				parsed.column
			] = knex.raw(`jsonb_set_recursive(??, '${jsonRefs}', ${valuePlaceholder})`, [
				convertedJson[parsed.column] || parsed.column,
				value
			]);

			delete model[key];
		} else {
			convertedJson[key] = value;
		}
	}

	return convertedJson;
}

