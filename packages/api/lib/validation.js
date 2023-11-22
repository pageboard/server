const { AjvValidator } = require('objection');
const Ajv = require('ajv');
const { _ } = Ajv;
const AjvKeywords = require('ajv-keywords');
const AjvFormats = require('ajv-formats');

const { betterAjvErrors } = require('@apideck/better-ajv-errors');
const Traverse = require('json-schema-traverse');
const fs = require('node:fs/promises');
const ajvStandalone = require.lazy("ajv/dist/standalone");
const Path = require('node:path');
const { exists } = require('../../../src/utils');

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
					schema.coerce = true;
				}
			} else if ('const' in schema) {
				schema.coerce = true;
			}
		}
	});
	return schema;
}

class AjvValidatorExt extends AjvValidator {
	#cacheDir;

	constructor(opts) {
		super(opts);
		this.#cacheDir = opts.cacheDir;
	}
	async prepare(mclass, pkg) {
		const schema = mclass.jsonSchema = fixSchema(mclass.jsonSchema);
		const cachePath = Path.join(
			this.#cacheDir,
			schema.$id
		);
		const cacheDir = Path.dirname(cachePath);
		const obj = {};
		this.cache.set(schema.$id, obj);
		await fs.mkdir(Path.join(cacheDir, 'node_modules'), { recursive: true });
		await fs.mkdir(Path.join(cacheDir, 'lib'), { recursive: true });
		await Promise.all([
			"node_modules/ajv",
			"node_modules/ajv-keywords",
			"node_modules/ajv-formats",
			"./lib/formats.js"
		].map(async mod => {
			try {
				await fs.symlink(
					Path.join(__dirname, '..', mod),
					Path.join(cacheDir, mod)
				);
			} catch (ex) {
				if (ex.code != 'EEXIST') throw ex;
			}
		}));

		const patchPath = cachePath + '-patch.js';
		try {
			if (!pkg.cache || !(await exists(patchPath))) {
				throw new Error();
			}
			const fn = require(patchPath);
			if (typeof fn != "function") throw new Error();
			obj.patchValidator = fn;
		} catch (ex) {
			if (ex.message) console.error(ex);
			// fixSchema mutates it
			const patchedSchema = Object.assign({}, schema);
			patchedSchema.$id += '-patch';
			obj.patchValidator = this.compilePatchValidator(patchedSchema);
			const patchCode = ajvStandalone.default(this.ajvNoDefaults, obj.patchValidator);
			await fs.writeFile(patchPath, patchCode);
		}

		const normalPath = cachePath + '-normal.js';
		try {
			if (!pkg.cache || !(await exists(normalPath))) {
				throw new Error();
			}
			const fn = require(normalPath);
			if (typeof fn != "function") throw new Error();
			obj.normalValidator = fn;
		} catch (ex) {
			if (ex.message) console.error(ex);
			obj.normalValidator = this.compileNormalValidator(schema);
			const normalCode = ajvStandalone.default(this.ajv, obj.normalValidator);
			await fs.writeFile(normalPath, normalCode);
		}
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
				patchSchema.$id = patchSchema.$id + '-patch';
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

		return validator;
	}
}

module.exports = class Validation {
	#validatorWithDefaults;
	#validatorNoDefaults;

	static AjvOptions = {
		$data: true,
		allErrors: true,
		discriminator: true,
		ownProperties: true,
		coerceTypes: 'array',
		removeAdditional: false,
		formats: require('./formats')
	};

	constructor(schemas, { filesCache }) {
		this.cacheDir = filesCache;

		this.rootSchema = fixSchema({
			definitions: schemas
		});

		this.#validatorWithDefaults = this.#setupAjv(
			new Ajv(this.#createSettings({
				useDefaults: 'empty'
			}))
		);

		this.#validatorNoDefaults = this.#setupAjv(
			new Ajv(this.#createSettings({
				useDefaults: false
			}))
		);
	}
	#setupAjv(ajv) {
		AjvFormats(ajv);
		AjvKeywords(ajv);

		this.#customKeywords(ajv);
		ajv.removeKeyword("multipleOf");
		ajv.addKeyword({
			keyword: "multipleOf",
			type: "number",
			code(cxt) {
				const { schema, data } = cxt;
				const { _ } = Ajv;
				let decimalPlaces = 0;
				if (!Number.isNaN(schema)) {
					const parts = schema.toString().split('e');
					if (parts.length === 2) {
						if (parts[1][0] === '-') {
							decimalPlaces = Number(parts[1].slice(1));
						}
					}
					const decimalParts = parts[0].split('.');
					if (decimalParts.length === 2) {
						decimalPlaces += decimalParts[1].length;
					}
				}
				cxt.pass(_`Number.isInteger((1e${decimalPlaces} * ${data}) / (1e${decimalPlaces} * ${schema}))`);
			},
			errors: false,
			metaSchema: {
				type: "number"
			},
		});
		// otherwise the `format` keyword would validate before `coerce`
		// https://github.com/epoberezkin/ajv/issues/986
		const rules = ajv.RULES.types.string.rules;
		rules.unshift(rules.pop());
		return ajv;
	}
	createValidator() {
		return new AjvValidatorExt({
			cacheDir: this.cacheDir,
			onCreateAjv: (ajv) => this.#setupAjv(ajv),
			options: {
				...Validation.AjvOptions,
				strictSchema: "log",
				validateSchema: false,
				code: {
					source: true,
					formats: _`Object.assign(
						require("ajv-formats/dist/formats").fullFormats,
						require('./lib/formats')
					)`
				}
			}
		});
	}
	#createSettings(opts) {
		return {
			...Validation.AjvOptions,
			strictSchema: "log",
			validateSchema: true,
			invalidDefaults: 'log',
			...opts
		};
	}
	#customKeywords(ajv) {
		ajv.addKeyword({
			keyword: '$filter',
			schemaType: ["string", "object"]
		});
		ajv.addKeyword({
			keyword: '$helper',
			schemaType: ["string", "object"]
		});
		ajv.addKeyword({
			keyword: '$level',
			schemaType: "number"
		});
		ajv.addKeyword({
			keyword: 'parents',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: 'templates',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: 'upgrade',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: '$global',
			schemaType: "boolean"
		});
		ajv.addKeyword({
			keyword: 'csp',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: 'standalone',
			schemaType: "boolean"
		});
		ajv.addKeyword({
			keyword: 'output',
			schemaType: "object"
		});
		ajv.addKeyword({
			keyword: '$lock',
			schemaType: ["object", "boolean"]
		});
		ajv.addKeyword({
			keyword: '$action',
			schemaType: "string"
		});
		ajv.addKeyword({
			keyword: 'icon',
			schemaType: "string"
		});
		ajv.addKeyword({
			keyword: 'context',
			schemaType: "string"
		});
		ajv.addKeyword({
			keyword: 'content',
			schemaType: ["object", "string"]
		});
		ajv.addKeyword({
			keyword: 'coerce',
			modifying: true,
			schemaType: 'boolean',
			errors: false,
			code(cxt) {
				const { gen, parentSchema, data, it } = cxt;
				const { format } = parentSchema;
				const { parentData, parentDataProperty } = it;

				if ('const' in parentSchema && typeof parentSchema.const == "number") {
					gen.if(_`typeof ${data} == "string" && ${data} != null`, () => {
						const num = gen.const("num", _`Number(${data})`);
						gen.if(_`!Number.isNaN(${num})`, () => {
							gen.assign(_`${parentData}[${parentDataProperty}]`, num);
						});
					});
				} else if (parentSchema.type == "string") {
					if (parentSchema.default !== undefined) {
						gen.if(_`${data} === ""`, () => {
							gen.assign(_`${parentData}[${parentDataProperty}]`, _`${parentSchema.default}`);
						});
					} else if (parentSchema.nullable) {
						gen.if(_`${data} === ""`, () => {
							gen.code(_`delete ${parentData}[${parentDataProperty}]`);
						});
					}
				} else if (["date", "time", "date-time"].includes(format)) {
					const d = gen.const("d", _`new Date(${data})`);
					gen.if(_`Number.isNaN(${d}.getTime())`, () => {
						gen.assign(_`${parentData}[${parentDataProperty}]`, null);
					});
					gen.else(() => {
						const dstr = gen.const("dstr", _`${d}.toISOString()`);
						if (format == "date") {
							gen.assign(_`${parentData}[${parentDataProperty}]`, _`${dstr}.split('T').shift()`);
						} else if (format == "time") {
							gen.assign(_`${parentData}[${parentDataProperty}]`, _`${dstr}.split('T').pop()`);
						} else {
							gen.assign(_`${parentData}[${parentDataProperty}]`, dstr);
						}
					});
				}
			}
		});
		return ajv;
	}

	validate(schema, data, inst) {
		if (!schema) return data;
		if (!inst.validate) {
			schema = Object.assign(fixSchema(schema), this.rootSchema);
			if (schema.defaults === false) {
				inst.validate = this.#validatorNoDefaults.compile(schema);
			} else {
				inst.validate = this.#validatorWithDefaults.compile(schema);
			}
		}
		// coerceTypes mutates data
		if (inst.validate(data)) {
			return data;
		} else {
			const messages = betterAjvErrors({
				schema,
				data,
				errors: inst.validate.errors
			});
			const str = '\n' + messages.map(
				item => ' ' + item.message.replaceAll(/\{base\}/g, 'data')
			).join('\n');
			throw new HttpError.BadRequest(str);
		}
	}
};
