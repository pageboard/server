const { AjvValidator } = require('objection');
const Ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');
const AjvFormats = require('ajv-formats');
const { betterAjvErrors } = require('@apideck/better-ajv-errors');
const Traverse = require('json-schema-traverse');
const fs = require('node:fs/promises');
const ajvStandalone = require.lazy("ajv/dist/standalone");
const Path = require('node:path');

function fixSchema(schema) {
	Traverse(schema, {
		cb: (schema) => {
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
	async prepare(jsonSchema, pkg) {
		const p = this.cache.get(jsonSchema.$id);
		if (p) {
			console.warn("Already has cached validators", jsonSchema.$id);
		}
		const cachePath = Path.join(
			this.#cacheDir,
			jsonSchema.$id
		);
		const cacheDir = Path.dirname(cachePath);
		const obj = {};
		await fs.mkdir(Path.join(cacheDir, 'node_modules'), { recursive: true });
		try {
			await fs.symlink(Path.join(__dirname, '../node_modules/ajv'), Path.join(cacheDir, 'node_modules', 'ajv'));
			await fs.symlink(Path.join(__dirname, '../node_modules/ajv-keywords'), Path.join(cacheDir, 'node_modules', 'ajv-keywords'));
		} catch (ex) {
			if (ex.code != 'EEXIST') throw ex;
		}
		const patchPath = cachePath + '-patch.js';
		try {
			if (!pkg.cache || !(await fileExists(patchPath))) {
				throw new Error();
			}
			obj.patchValidator = require(patchPath);
		} catch (ex) {
			if (ex.code) console.error(ex);
			obj.patchValidator = this.compilePatchValidator(jsonSchema);
			const patchCode = ajvStandalone.default(this.ajvNoDefaults, obj.patchValidator);
			await fs.writeFile(patchPath, patchCode);
		}
		const normalPath = cachePath + '-normal.js';
		try {
			if (!pkg.cache || !(await fileExists(normalPath))) {
				throw new Error();
			}
			obj.normalValidator = require(normalPath);
		} catch (ex) {
			if (ex.code) console.error(ex);
			obj.normalValidator = this.compileNormalValidator(jsonSchema);
			const normalCode = ajvStandalone.default(this.ajv, obj.normalValidator);
			await fs.writeFile(normalPath, normalCode);
		}
		this.cache.set(jsonSchema.$id, obj);
	}

	compilePatchValidator(jsonSchema) {
		const schema = jsonSchemaWithoutRequired(
			fixSchema(jsonSchema)
		);
		return this.ajvNoDefaults.compile(schema);
	}
	compileNormalValidator(jsonSchema) {
		return this.ajv.compile(
			fixSchema(jsonSchema)
		);
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
		removeAdditional: "failing",
		formats: require('./formats'),
		serialize(schema) {
			return schema.$id;
		}
	};

	constructor(app, opts) {
		this.app = app;
		this.#validatorWithDefaults = this.#setupAjv(
			new Ajv(this.#createSettings({ useDefaults: 'empty' }))
		);
		this.#validatorNoDefaults = this.#setupAjv(
			new Ajv(this.#createSettings({ useDefaults: false }))
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
			cacheDir: this.app.dirs.filesCache,
			onCreateAjv: (ajv) => this.#setupAjv(ajv),
			options: {
				...Validation.AjvOptions,
				strictSchema: this.app.env == "dev" ? "log" : false,
				validateSchema: false,
				code: {
					source: true,
					formats: require('./formats.js')
				}
			}
		});
	}
	#createSettings(opts) {
		return {
			...Validation.AjvOptions,
			strictSchema: this.app.env == "dev" ? "log" : false,
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
			keyword: 'upgrade',
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
				const { _ } = Ajv;

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
			fixSchema(schema);
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

// NB: this is mostly objection code, do not refactor
function jsonSchemaWithoutRequired(jsonSchema) {
	const subSchemaProps = ['anyOf', 'oneOf', 'allOf', 'not', 'then', 'else', 'properties'];
	const discriminatorRequired = {};
	if (jsonSchema.discriminator && jsonSchema.discriminator.propertyName) {
		discriminatorRequired.required = [jsonSchema.discriminator.propertyName];
	}
	return Object.assign(
		omit(jsonSchema, ['required', ...subSchemaProps]),
		discriminatorRequired,
		...subSchemaProps.map(prop => subSchemaWithoutRequired(jsonSchema, prop)),
		jsonSchema && jsonSchema.definitions
			? {
				definitions: Object.assign(
					...Object.keys(jsonSchema.definitions).map(prop => ({
						[prop]: jsonSchemaWithoutRequired(jsonSchema.definitions[prop]),
					}))
				),
			}
			: {}
	);
}

function subSchemaWithoutRequired(jsonSchema, prop) {
	if (jsonSchema[prop]) {
		if (Array.isArray(jsonSchema[prop])) {
			const schemaArray = jsonSchemaArrayWithoutRequired(jsonSchema[prop]);

			if (schemaArray.length !== 0) {
				return {
					[prop]: schemaArray,
				};
			} else {
				return {};
			}
		} else if (prop == "properties" && jsonSchema.type == "object") {
			return {
				[prop]: jsonSchemaPropertiesWithoutRequired(jsonSchema[prop])
			};
		} else {
			return {
				[prop]: jsonSchemaWithoutRequired(jsonSchema[prop]),
			};
		}
	} else {
		return {};
	}
}

function jsonSchemaPropertiesWithoutRequired(jsonSchemaProperties) {
	const schema = {};
	for (const [key, sub] of Object.entries(jsonSchemaProperties)) {
		schema[key] = jsonSchemaWithoutRequired(sub);
	}
	return schema;
}

function jsonSchemaArrayWithoutRequired(jsonSchemaArray) {
	return jsonSchemaArray
		.map(jsonSchemaWithoutRequired)
		.filter(obj => !Object.isEmpty(obj));
}

function omit(obj, keys) {
	return Object.fromEntries(
		Object.entries(obj).filter(([key]) => !keys.includes(key))
	);
}

async function fileExists(path) {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
