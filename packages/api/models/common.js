const { ref, val, raw, fn: fun, Model, QueryBuilder } = require('@kapouer/objection');
const Duration = require('iso8601-duration');
const Path = require('node:path');
const { dget, flatten } = require('../../../src/utils');

const { isKnexRaw, isKnexQueryBuilder } = require(
	Path.join(
		require.resolve('@kapouer/objection'),
		'..',
		'utils/knexUtils'
	)
);

const { isObject } = require(
	Path.join(
		require.resolve('@kapouer/objection'),
		'..',
		'utils/objectUtils'
	)
);

const { UpdateOperation } = require(
	Path.join(
		require.resolve('@kapouer/objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
);

const { InstanceUpdateOperation } = require(
	Path.join(
		require.resolve('@kapouer/objection'),
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
		const jsonPaths = asPaths(json, [
			this.model.$schema()
		]);
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
		if (opts.old?.updated_at && this.updated_at) {
			if (Date.parse(opts.old.updated_at) < Date.parse(this.updated_at)) {
				// keep the one already set
				return;
			}
		}
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
	columns({ table, lang, content = null } = {}) {
		const model = this.modelClass();
		if (!table) table = this.tableRefFor(model);
		const cols = [];
		for (const col of model.columns) {
			const rcol = ref(col).from(table);
			if (col == 'content') {
				if (content?.length === 0) continue;
				if (lang) {
					cols.push(
						raw(`(block_get_content(:id:, :lang, :content)) AS content`, {
							id: ref('_id').from(table),
							lang,
							content
						})
					);
					continue;
				} else if (content) {
					// single language old sites
					cols.push(
						raw(`jsonb_build_object(
							${content.map(_ => '?::text, block.content[?]').join(', ')}
						) AS content`, content.flatMap(n => [n, n]))
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

		const schemas = types.map(type => {
			const sch = mClass.schema(type);
			if (!sch) throw new HttpError.BadRequest("Missing schema for: " + type);
			return sch;
		});
		const table = alias || this.tableRefFor(mClass);
		const refs = asPaths(obj, schemas, table);

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

const comparisons = {
	lt: '<',
	lte: '<=',
	gt: '>',
	gte: '>='
};

function whereCondObject(q, refk, cond) {
	const { type, op, range, names, start, end, val: cval } = cond;
	if (op in comparisons) {
		if (cval instanceof Date) {
			// DEAD CODE because asPaths doesn't return such a cond
			q.where(refk.castTo('date'), comparisons[op], cval);
		} else if (["integer", "number"].includes(cond.type)) {
			q.where(refk.castFloat(), comparisons[op], cval);
		} else {
			q.where(refk.castText(), comparisons[op], cval);
		}
	} else if (range == "date") {
		if (names) {
			// slot intersection
			const rstart = ref(`${refk.expression}.${names[0]}`);
			const rend = ref(`${refk.expression}.${names[1]}`);
			q.whereNotNull(rstart); // TODO optional start
			q.whereNotNull(rend); // TODO optional end
			if (start == end) {
				q.whereRaw(`daterange(:start:, :end:) @> :at OR :start: = :end: AND :start: = :at`, {
					start: rstart.castTo('date'),
					end: rend.castTo('date'),
					at: val(start).castTo('date')
				});
			} else {
				q.whereRaw(`daterange(:from, :to) && daterange(:start:, :end:)`, {
					start: rstart.castTo('date'),
					end: rend.castTo('date'),
					from: val(start).castTo('date'),
					to: val(end).castTo('date')
				});
			}
		} else {
			q.whereNotNull(refk);
			if (start == end) {
				q.whereIn(refk.castTo('date'), [
					val(start).castTo('date'),
					val(end).castTo('date')
				]);
			} else {
				q.whereRaw(`daterange(:from, :to) @> :at:`, {
					from: val(start).castTo('date'),
					to: val(end).castTo('date'),
					at: refk.castTo('date')
				});
			}
		}
	} else if (op == "not") {
		q.whereNot(refk.castText(), cval);
	} else if (op == "is") {
		q.where(fun('jsonb_typeof', fun('coalesce', refk, val(null).castJson())), cval);
	} else if (op == "end") {
		q.where(refk.castText(), "ilike", '%' + cval);
	} else if (op == "start") {
		q.where(refk.castText(), "ilike", cval + '%');
	} else if (op == "has") {
		if (type == "string" && typeof cval == "string") {
			// ref is a string and it contains that value
			q.where(refk.castText(), "ilike", '%' + cval + '%');
		} else {
			// ref is a json text or array, and it intersects any of the values
			const rval = typeof cval == "string" ? [cval] : cval;
			if (rval != null) q.whereRaw('?? \\?| ?', [refk, rval]);
		}
	} else if (op == "in") {
		if (type == "string" && typeof cval == "string") {
			// ref is a string and it is contained in that value
			q.whereRaw("? ilike '%' || ?? || '%'", [cval, refk.castText()]);
		} else {
			// ref is a json string, and it is in the values
			const rval = typeof cval == "string" ? [cval] : cval;
			if (rval != null) q.whereRaw('?? \\?& ?', [refk, rval]);
		}
	} else if (range == "numeric") {
		if (names) {
			const rstart = ref(`${refk.expression}.${cond.names[0]}`);
			const rend = ref(`${refk.expression}.${cond.names[1]}`);
			q.whereNotNull(rstart); // TODO optional start
			q.whereNotNull(rend); // TODO optional end
			if (start == end) {
				q.whereRaw(`(numrange(:start:, :end:) @> :at OR (:start: = :at AND :end: = :at))`, {
					start: rstart.castTo('numeric'),
					end: rend.castTo('numeric'),
					at: val(start).castTo('numeric')
				});
			} else {
				q.whereRaw(`numrange(:from, :to) && numrange(:start:, :end:)`, {
					start: rstart.castTo('numeric'),
					end: rend.castTo('numeric'),
					from: val(start).castTo('numeric'),
					to: val(end).castTo('numeric')
				});
			}
		} else {
			q.whereRaw(':col: <@ numrange(:from, :to)', {
				col: refk.castTo('numeric'),
				from: val(start).castTo('numeric'),
				to: val(end).castTo('numeric')
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
		if (value.length > 0) q.where(q => {
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
		else q.whereNull(refk);
		return q;
	}

	if (typeof value == "object") {
		whereCondObject(q, refk, value);
	} else {
		q.where(refk.castTo(getCast(value)), value);
	}
}

const dateTimes = ["date-time", "date"];

function asPaths(obj, schemas = [], pre = "") {
	const ret = {};
	const flats = flatten(obj, { array: true, nulls: true });
	for (const [str, val] of Object.entries(flats)) {
		const [key, op] = str.split(/[:#]/);
		if (op != null) {
			delete flats[str];
		}
		let schema, parent;
		const pathKey = key.split('.');
		const pathLen = pathKey.length;
		const lastKey = pathKey.pop();
		const parentSchemaPath = pathKey.join('.properties.');
		const firstKey = pathKey.shift();
		for (const subSchema of schemas) {
			parent = parentSchemaPath ? dget(subSchema.properties, parentSchemaPath) : subSchema;
			if (!parent) continue;
			if (parent.type == "array") {
				schema = parent;
				break;
			}
			schema = dget(parent, 'properties.' + lastKey);
			if (schema) break;
			if (parent?.additionalProperties && typeof parent?.additionalProperties == "object") {
				schema = parent;
				break;
			}
		}
		if (!schema && schemas?.length) {
			// refuse extra conditions
			delete flats[key];
			continue;
		}
		let ref = pre ? `${pre}.` : '';
		let parentRef = ref;
		if (pathLen == 1) {
			ref += lastKey;
		} else {
			parentRef += `${firstKey}:${buildRef(pathKey)}`;
			ref = parentRef + buildRef([lastKey]);
		}

		let wasRangeSchema;
		if (schema.additionalProperties) {
			if (!ret[parentRef]) ret[parentRef] = {};
			ret[parentRef][lastKey] = val;
		} else if (
			val && (
				typeof val == "string"
				|| typeof val == "object"
				|| Array.isArray(val)
			)
			&& (wasRangeSchema || isRangeSchema(schema))
		) {
			// we have a date or numeric slot
			wasRangeSchema ??= schema.type;
			let range;
			if (wasRangeSchema == "integer") {
				range = numericRange(val, schema);
			} else {
				range = dateRange(val, schema.format);
			}
			if (range) {
				range.names = Object.keys(schema.properties);
				setCondition(ret, ref, range);
			} else if (op) {
				setCondition(ret, ref, { op, val });
			} else {
				setCondition(ret, ref, val);
			}
		} else if (Array.isArray(val) || val == null || typeof val != "object") {
			let dval = val;
			if (val && schema.type == "string" && dateTimes.includes(schema.format)) {
				if (op) {
					dval = new Date(val);
				} else {
					const range = dateRange(val, schema.format);
					if (range) {
						dval = range;
					} else {
						dval = new Date(val);
					}
				}
			} else if (schema.type == "boolean" && typeof val != "boolean") {
				if (!val || val == "false") {
					if (schema.default == false) {
						dval = [false, null];
					} else {
						dval = false;
					}
				} else {
					dval = true;
				}
			} else if (["integer", "number"].includes(schema.type) && typeof val == "string" && (val.includes("~") || val.includes("⩽"))) {
				dval = numericRange(val, schema);
			}
			if (op) {
				setCondition(ret, ref, {
					type: schema.type,
					op,
					val: dval
				});
			} else {
				setCondition(ret, ref, dval);
			}
		}
	}
	return ret;
}

function buildRef(list) {
	return list.map(key => `[${key}]`).join('');
}

function setCondition(ret, ref, obj) {
	const prev = ret[ref];
	if (prev) {
		if (prev.op && obj.op && prev.op != obj.op && ['lte', 'gte'].includes(prev.op) && ['lte', 'gte'].includes(obj.op)) {
			// a range
			ret[ref] = {
				range: 'numeric',
				start: prev.op == "gte" ? prev.val : obj.val,
				end: obj.op == "lte" ? obj.val : prev.val
			};
		} else {
			throw new Error("Conflicting conditions: " + JSON.stringify(prev) + ", " + JSON.stringify(obj));
		}
	} else {
		ret[ref] = obj;
	}
}

function isRangeSchema(schema) {
	const keys = Object.keys(schema.properties ?? {});
	return schema.type == "object" && keys.length == 2 && (
		dateTimes.includes(schema.properties[keys[0]].format)
		&& dateTimes.includes(schema.properties[keys[1]].format)
		|| schema.properties[keys[0]].type == "integer"
		&& schema.properties[keys[1]].type == "integer"
	);
}

function dateRange(val, format) {
	let start, end;
	if (typeof val == "string") {
		const range = partialDateRange(val, format);
		if (range) [start, end] = range;
		else return;
	} else if (Array.isArray(val) && val.length == 2) {
		start = new Date(val[0]);
		end = new Date(val[1]);
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

function partialDateRange(val, format) {
	const parts = val.split(/--P|\/P|P/);
	if (parts[0].includes('T')) return;
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
			if (format == "date") return;
			end.setDate(end.getDate() + 1);
		}
	} else if (parts.length == 2) {
		end = Duration.end(Duration.parse('P' + parts[1]), start);
	}
	if (Number.isNaN(end.getTime())) end = start;
	return [start, end];
}

function numericRange(val, schema) {
	if (typeof val == "string") {
		const [start, end] = val.split(/~|⩽/).map(n => {
			return (schema.type == "integer" ? parseInt : parseFloat)(n);
		});
		return {
			range: "numeric",
			start: start,
			end: end ?? start
		};
	} else if (typeof val == "object") {
		const keys = Object.keys(schema.properties);
		const start = val[keys[0]];
		const end = val[keys[1]];
		return {
			range: "numeric",
			start,
			end: end ?? start
		};
	}
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

