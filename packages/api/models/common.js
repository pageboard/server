const { ref, val, raw, Model, QueryBuilder } = require('objection');
const Duration = require('iso8601-duration');

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

const { UpdateOperation } = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
);

const { InstanceUpdateOperation } = require(
	require('path').join(
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
	selectWithout(...args) {
		const model = this.modelClass();
		const table = this.tableRefFor(model);
		const list = [];
		model.columns.forEach((col) => {
			if (args.includes(col) == false) list.push(`${table}.${col}`);
		});
		return super.select(list);
	}
	select(...args) {
		if (args.length == 0) {
			const model = this.modelClass();
			const table = this.tableRefFor(model);
			args = model.columns.map(col => `${table}.${col}`);
		}
		return super.select(args);
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
	whereObject(obj, type, alias) {
		const mClass = this.modelClass();
		if (Array.isArray(type)) {
			if (type.length == 1) type = type[0];
			else type = null;
		}
		const schema = type ? mClass.schema(type) : null;
		const table = alias || this.tableRefFor(mClass);
		const refs = asPaths(obj, {}, table, true, schema);
		const comps = {
			lt: '<',
			lte: '<=',
			gt: '>',
			gte: '>='
		};
		Object.keys(refs).forEach(function(k) {
			const cond = refs[k];
			const refk = ref(k);
			if (cond == null) {
				this.whereNull(refk);
			} else if (Array.isArray(cond)) {
				this.where(refk.castText(), 'IN', cond);
			} else if (typeof cond == "object") {
				if (cond.op in comps) {
					if (cond.val instanceof Date) {
						// DEAD CODE because asPaths doesn't return such a cond
						this.where(refk.castTo('date'), comps[cond.op], cond.val);
					} else if (typeof cond.val == "number") {
						this.where(refk.castFloat(), comps[cond.op], cond.val);
					} else {
						this.where(refk.castText(), comps[cond.op], cond.val);
					}
				} else if (cond.range == "date") {
					if (cond.names) {
						// slot intersection
						const start = `${k}.${cond.names[0]}`;
						const end = `${k}.${cond.names[1]}`;
						this.whereNotNull(ref(start));
						this.whereNotNull(ref(end));
						if (cond.start == cond.end) {
							this.whereRaw(`(daterange(:start:, :end:) @> :at OR (:start: = :at AND :end: = :at))`, {
								start: ref(start).castTo('date'),
								end: ref(end).castTo('date'),
								at: val(cond.start).castTo('date')
							});
						} else {
							this.whereRaw(`daterange(:from, :to) && daterange(:start:, :end:)`, {
								start: ref(start).castTo('date'),
								end: ref(end).castTo('date'),
								from: val(cond.start).castTo('date'),
								to: val(cond.end).castTo('date')
							});
						}
					} else {
						this.whereNotNull(refk);
						if (cond.start == cond.end) {
							this.whereIn(refk.castTo('date'), [
								val(cond.start).castTo('date'),
								val(cond.end).castTo('date')
							]);
						} else {
							this.whereRaw(`(daterange(:from, :to) @> :at: OR (:at: = :from AND :at: = :to))`, {
								from: val(cond.start).castTo('date'),
								to: val(cond.end).castTo('date'),
								at: refk.castTo('date')
							});
						}
					}
				} else if (cond.op == "not") {
					this.whereNot(refk.castText(), cond.val);
				} else if (cond.op == "end") {
					this.where(refk.castText(), "like", '%' + cond.val);
				} else if (cond.op == "start") {
					this.where(refk.castText(), "like", cond.val + '%');
				} else if (cond.op == "has") {
					// ref is a json text or array, and it intersects any of the values
					const val = typeof cond.val == "string" ? [cond.val] : cond.val;
					this.whereRaw('?? \\?| ?', [refk, val]);
				} else if (cond.op == "in") {
					// ref is a json string, and it is in the values
					const val = typeof cond.val == "string" ? [cond.val] : cond.val;
					this.whereIn(refk, val);
				} else if (cond.range == "numeric") {
					this.whereRaw(':col: <@ numrange(:from, :to)', {
						col: refk,
						from: val(cond.start).castTo('numeric'),
						to: val(cond.end).castTo('numeric')
					});
				} else {
					throw new HttpError.BadRequest(
						`Bad condition operator ${JSON.stringify(cond)}`
					);
				}
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
	const dateTimes = ["date-time", "date"];
	Object.keys(obj).forEach(str => {
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
		if (val && schem.type == "object" && Object.keys(schem.properties).sort().join(' ') == "end start" && dateTimes.includes(schem.properties.start.format) && dateTimes.includes(schem.properties.end.format)) {
			// we have a date slot
			const range = dateRange(val);
			if (range) {
				ret[cur] = {
					range: "date",
					names: ["start", "end"],
					start: range[0],
					end: range[1]
				};
			} else if (op) ret[cur] = {
				op: op,
				val: val
			};
			else ret[cur] = val;
		} else if (Array.isArray(val) || val == null || typeof val != "object") {
			if (val && schem.type == "string" && dateTimes.includes(schem.format)) {
				if (op) {
					val = new Date(val);
				} else {
					const range = dateRange(val);
					if (range) {
						val = {
							range: "date",
							start: range[0],
							end: range[1]
						};
					}
				}
			} else if (schem.type == "boolean" && typeof val != "boolean") {
				if (val == "false" || val == 0 || !val) val = false;
				else val = true;
			} else if (["integer", "number"].includes(schem.type) && typeof val == "string" && (val.includes("~") || val.includes("⩽"))) {
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
	if (typeof val == "string") {
		return partialDateRange(val);
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
		return [start, end];
	}
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
	const [start, end] = val.split(/~|⩽/).map((n) => {
		return (type == "integer" ? parseInt : parseFloat)(n);
	});
	return {
		range: "numeric",
		start: start,
		end: end
	};
}

function deepAssign(model, obj) {
	Object.keys(obj).forEach((key) => {
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
		let val = json[key];

		if (key.indexOf(':') > -1) {
			// 'col:attr' : ref('other:lol') is transformed to
			// "col" : raw(`jsonb_set("col", '{attr}', to_jsonb("other"#>'{lol}'), true)`)

			const parsed = ref(key);
			const jsonRefs = '{'
				+ parsed.parsedExpr.access.map(it => it.ref).join(',')
				+ '}';
			let valuePlaceholder = '?';

			if (isKnexQueryBuilder(val) || isKnexRaw(val)) {
				valuePlaceholder = 'to_jsonb(?)';
			} else {
				val = JSON.stringify(val);
			}

			convertedJson[
				parsed.column
			] = knex.raw(`jsonb_set_recursive(??, '${jsonRefs}', ${valuePlaceholder})`, [
				convertedJson[parsed.column] || parsed.column,
				val
			]);

			delete model[key];
		} else {
			convertedJson[key] = val;
		}
	}

	return convertedJson;
}

