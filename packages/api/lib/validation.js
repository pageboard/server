const { AjvValidator } = require('@kapouer/objection');
const Ajv = require('ajv');
const { _ } = Ajv;
const AjvKeywords = require('ajv-keywords');
const AjvFormats = require('ajv-formats');
const { dget } = require('../../../src/utils');

const { betterAjvErrors } = require('@apideck/better-ajv-errors');
const Traverse = require('json-schema-traverse');

function fixSchema(schema) {
	if (schema.definitions) for (const type of Object.values(schema.definitions)) {
		fixSchema(type);
	}
	Traverse(schema, {
		cb(schema) {
			if (schema.properties && schema.type == null) {
				schema.type = 'object';
			}
			if (schema.type == "object") {
				if (schema.additionalProperties == null) {
					schema.additionalProperties = !schema.properties;
				}
			} else if (schema.type == "string") {
				if (schema.format || schema.pattern) {
					schema.$coerce = true;
				}
			} else if ('const' in schema && typeof schema.const == "number") {
				schema.$coerce = true;
			} else if (schema.anyOf?.length > 1) {
				let bools = 0;
				let strings = 0;
				let nulls = 0;
				for (const item of schema.anyOf) {
					if (item.type == "string") strings++;
					else if (typeof item.const == "boolean") bools++;
					else if (item.type == "null") nulls++;
				}
				if (strings == 1 && bools >= 1 && strings + bools + nulls == schema.anyOf.length) {
					schema.$coerce = true;
				}
			}
		}
	});
	return schema;
}

class AjvValidatorExt extends AjvValidator {

	async prepare(mclass, pkg) {
		const schema = mclass.jsonSchema = fixSchema(mclass.jsonSchema);
		const obj = {};
		this.cache.set(schema.$id, obj);
		// schema compilation works but rebuilding ajv instance with $ref does not
		obj.normalValidator = this.compileNormalValidator(schema);
		const patchedSchema = Object.assign({}, schema);
		obj.patchValidator = this.compilePatchValidator(patchedSchema);
	}

	getValidator(modelClass, jsonSchema, isPatchObject) {
		// Optimization for the common case where jsonSchema is never modified.
		// In that case we don't need to call the costly createCacheKey function.
		let validators = this.cache.get(jsonSchema.$id);
		let validator = null;

		if (!validators) {
			validators = {
				// Validator created for the schema object without `required` properties
				// using the AJV instance that doesn't set default values.
				patchValidator: null,

				// Validator created for the unmodified schema.
				normalValidator: null,
			};
			this.cache.set(jsonSchema.$id, validators);
		}

		if (isPatchObject) {
			validator = validators.patchValidator;

			if (!validator) {
				const patchSchema = Object.assign({}, jsonSchema);
				validator = this.compilePatchValidator(patchSchema);
				validators.patchValidator = validator;
			}
		} else {
			validator = validators.normalValidator;

			if (!validator) {
				validator = this.compileNormalValidator(jsonSchema);
				validators.normalValidator = validator;
			}
		}

		return this.wrapValidator(validator);
	}

	wrapValidator(validator) {
		function newValidator(json) {
			delete newValidator.errors;
			const ret = validator.call(this, json);
			if (validator.errors?.length > 0) {
				const errors = validator.errors.filter(e => {
					const {
						instancePath: path,
						keyword, params
					} = e;
					if (!path) return true;
					if (path.startsWith("/data/action/parameters")) {
						const reqPath = path.split('/').slice(4);
						if (keyword == "required" && params.missingProperty) {
							reqPath.push(params.missingProperty);
						} else if (keyword == "format" && !dget(json?.data?.action?.parameters, reqPath)) {
							// maybe null, test request
						} else {
							return true;
						}
						return !json?.data?.action?.request?.[reqPath.join('.')];
					}
					return true;
				});
				if (errors.length == 0) {
					return true;
				} else {
					newValidator.errors = errors;
				}
			}
			return ret;
		}
		return newValidator;
	}
}

module.exports = class Validation {
	#servicesValidator;

	static AjvOptions = {
		$data: true,
		allErrors: true,
		discriminator: true,
		ownProperties: true,
		coerceTypes: 'array',
		invalidDefaults: 'log',
		multipleOfPrecision: 4,
		formats: require('./formats'),
		code: {
			optimize: false // much faster compilation
		}
	};

	constructor(services, elements) {
		this.elements = fixSchema(elements);
		this.services = fixSchema(services);

		const actions = { ...services, definitions: {} };
		const { definitions } = actions;
		for (const [name, service] of Object.entries(services.definitions)) {
			if (!service.$private && service.$action) {
				definitions[name] = service;
			}
		}
		actions.oneOf = Object.keys(definitions).map(key => {
			return { $ref: '#/definitions/' + key };
		});
		// needed for exporting writes/reads to client
		this.actions = actions;
		this.standalones = keepDefinitions(this.elements, 'standalone', true);
		this.standalones.$id = '/standalones';
		this.reads = keepDefinitions(this.actions, '$action', 'read');
		this.reads.$id = '/reads';
		this.writes = keepDefinitions(this.actions, '$action', 'write');
		this.writes.$id = '/writes';

		const helper = new AjvValidator({
			onCreateAjv: (ajv) => this.#setupAjv(ajv),
			options: {
				...Validation.AjvOptions,
				schemas: [this.elements, this.services],
				strictSchema: "log",
				useDefaults: 'empty',
				validateSchema: false,
				removeAdditional: "failing" // used to be false
			}
		});
		// $global services validator
		this.#servicesValidator = helper.ajv;
	}

	#setupAjv(ajv, modelClass) {
		if (modelClass?.jsonSchema.$id == "/elements") {
			// add /standalones ?
		}
		AjvKeywords(ajv);
		AjvFormats(ajv);
		this.#customKeywords(ajv);
		return ajv;
	}
	createValidator(modelClass) {
		// objection validator
		return new AjvValidatorExt({
			onCreateAjv: (ajv) => this.#setupAjv(ajv, modelClass),
			options: {
				...Validation.AjvOptions,
				schemas: [
					this.services, this.reads, this.writes
				],
				strictSchema: "log",
				validateSchema: false,
				removeAdditional: "failing",
				invalidDefaults: 'log'
			}
		});
	}

	#customKeywords(ajv) {
		ajv.addKeyword({
			// used for preparing schema for semafor in write module
			keyword: '$filter',
			schemaType: ["string", "object"]
		});
		ajv.addKeyword({
			// used for adding widgets to semafor in write module
			keyword: '$helper',
			schemaType: ["string", "object"]
		});
		ajv.addKeyword({
			keyword: '$level',
			schemaType: "number"
		});
		ajv.addKeyword({
			// used by block API
			keyword: 'parents',
			schemaType: "object"
		});
		ajv.addKeyword({
			// API templates fields, allows fusing data into expr
			keyword: 'templates',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: 'upgrade',
			schemaType: "object"
		});
		ajv.addKeyword({
			// adds Content-Security-Policy headers
			keyword: 'csp',
			schemaType: "object"
		});
		ajv.addKeyword({
			// defines if that type of element can be without parent
			keyword: 'standalone',
			schemaType: "boolean"
		});
		ajv.addKeyword({
			// list properties that should have unique values across a site
			keyword: 'unique',
			schemaType: "array"
		});
		ajv.addKeyword({
			// is this a private service
			keyword: '$private',
			schemaType: "boolean"
		});
		ajv.addKeyword({
			// required permissions to view that element or its properties
			keyword: '$lock',
			schemaType: ["string", "array", "object"]
		});
		ajv.addKeyword({
			// properties that can accept an uploaded file
			keyword: '$file',
			metaSchema: {
				type: 'object',
				properties: {
					size: {
						type: 'integer',
						default: 100000000
					},
					types: {
						type: 'array',
						items: {
							type: 'string'
						},
						default: ['*/*']
					}
				}
			},
			error: {
				message: 'File rejected because of its size or mime type'
			},
			validate({ size, types }, data) {
				if (!data) return true;
				const href = global.AllHrefs[data];
				if (href) {
					if (size > 0 && href.meta.size > size) {
						return false;
					}
					if (!href.mime) return false;
					if (types?.length > 0) {
						const [ctype, csub] = href.mime.split('/');
						return types.some(pat => {
							const [type, sub] = pat.split('/');
							return (type == "*" || type == ctype) && (sub == "*" || sub == csub);
						});
					}
				} else {
					// FIXME use async validation and do a DB request here
				}
				return true;
			}
		});
		ajv.addKeyword({
			// cache
			keyword: '$cache',
			schemaType: ["string", "boolean"]
		});
		ajv.addKeyword({
			// cache
			keyword: '$tags',
			schemaType: ["array"]
		});
		ajv.addKeyword({
			// a service is either reading or writing data
			keyword: '$action',
			metaSchema: {
				enum: ['read', 'write']
			}
		});
		ajv.addKeyword({
			// sets if it does not depend on a site instance
			keyword: '$global',
			schemaType: "boolean"
		});
		ajv.addKeyword({
			// icon for write toolbar
			keyword: 'icon',
			schemaType: "string"
		});
		ajv.addKeyword({
			// elements can have context:
			// https://prosemirror.net/docs/ref/#model.ParseRule.context
			// elements properties can have context,
			// in which case the property is shown in write form iif its block
			// satisfies the given ancestor type
			keyword: 'context',
			schemaType: "string"
		});
		ajv.addKeyword({
			// defines prosemirror schema for element content
			keyword: 'content',
			schemaType: ["object", "string"]
		});
		ajv.addKeyword({
			// NOTE: there is no actual guarantee that format
			// is applied before $coerce, but it seems it is the case.
			keyword: '$coerce',
			schemaType: 'boolean',
			valid: true,
			errors: false,
			code(cxt) {
				const { gen, parentSchema, data, it } = cxt;
				const { format } = parentSchema;
				const { parentData, parentDataProperty } = it;

				if (parentSchema.type == 'array') {
					gen.if(_`${data} instanceof Set`, () => {
						gen.assign(data, _`Array.from(${data})`);
						gen.assign(_`${parentData}[${parentDataProperty}]`, data);
					});
				} else if ('const' in parentSchema && typeof parentSchema.const == "number") {
					gen.if(_`typeof ${data} == "string" && ${data} != null`, () => {
						const num = gen.const("num", _`Number(${data})`);
						gen.if(_`!Number.isNaN(${num})`, () => {
							gen.assign(data, num);
							gen.assign(_`${parentData}[${parentDataProperty}]`, data);
						});
					});
				} else if (parentSchema.anyOf?.length > 1) {
					const expr = gen.let('expr');
					const hasNull = parentSchema.anyOf.find(item => item.type == "null");
					gen
						.if(_`typeof ${data} == 'string' && ['true', 'false'].includes(${data})`)
						.assign(expr, _`${data} == 'true'`)
						.elseIf(_`${data} == null`)
						.assign(expr, hasNull ? _`null` : _`false`)
						.else()
						.assign(expr, _`${data}`)
						.endIf();
					gen.assign(data, expr);
					gen.assign(_`${parentData}[${parentDataProperty}]`, data);
				} else if (parentSchema.type == "string") {
					if (parentSchema.default !== undefined) {
						gen.if(_`${data} === ""`, () => {
							gen.assign(data, _`${parentSchema.default}`);
							gen.assign(_`${parentData}[${parentDataProperty}]`, data);
						});
					} else if (parentSchema.nullable) {
						gen.if(_`${data} === ""`, () => {
							gen.assign(data, _`undefined`);
							gen.assign(_`${parentData}[${parentDataProperty}]`, data);
						});
					}
					if (["date", "time", "date-time"].includes(format)) {
						const d = gen.const("d", _`new Date(${data})`);
						gen.if(_`Number.isNaN(${d}.getTime())`);
						gen.assign(data, null);
						gen.assign(_`${parentData}[${parentDataProperty}]`, data);
						gen.else();
						const dstr = gen.const("dstr", _`${d}.toISOString()`);
						if (format == "date") {
							gen.assign(data, _`${dstr}.split('T').shift()`);
						} else if (format == "time") {
							gen.assign(data, _`${dstr}.split('T').pop()`);
						} else {
							gen.assign(data, dstr);
						}
						gen.assign(_`${parentData}[${parentDataProperty}]`, data);
						gen.endIf();
					}
				}
			}
		});
		return ajv;
	}

	validate(req, data) {
		const validator = req.site ?
			req.site.$modelClass.getValidator().ajv
			: this.#servicesValidator;
		validator.validate('/services', data);
		const { errors } = validator;
		if (!errors?.length) {
			return data;
		}
		const messages = betterAjvErrors({
			schema: this.services,
			data,
			errors
		});
		const str = '\n' + messages.map(
			item => {
				const repl = item.message.replaceAll(/\{base\}/g, 'data');
				if (repl != item.message) {
					return ' ' + repl;
				} else {
					return ' ' + item.message + ' at: ' + item.path.replaceAll(/\{base\}/g, 'data');
				}
			}
		).join('\n');
		throw new HttpError.BadRequest(str);
	}
};

function keepDefinitions(schema, key, val) {
	schema = { ...schema };
	const { definitions } = schema;
	delete schema.definitions;
	const id = schema.$id;
	const list = [];
	for (const [name, service] of Object.entries(definitions)) {
		if (service[key] == val) {
			list.push({ $ref: `${id}#/definitions/${name}` });
		}
	}
	schema.oneOf = list.sort((a, b) => a.$ref.localeCompare(b.$ref));
	return schema;
}
