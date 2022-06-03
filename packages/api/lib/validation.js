const { AjvValidator } = require('objection');
const Ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');
const AjvFormats = require('ajv-formats');
const { default: betterAjvErrors } = require('better-ajv-errors');
const NP = require('number-precision');

class AjvValidatorExt extends AjvValidator {
	compilePatchValidator(jsonSchema) {
		jsonSchema = jsonSchemaWithoutRequired(jsonSchema);
		// We need to use the ajv instance that doesn't set the default values.
		return this.ajvNoDefaults.compile(jsonSchema);
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
		formats: {
			singleline: /^[^\n\r]*$/,
			pathname: /^(\/[\w.-]*)+$/,
			page: /^((\/[a-zA-Z0-9-]*)+)$|^(\/\.well-known\/\d{3})$/,
			id: /^[A-Za-z0-9]+$/,
			name: /^\w+$/, // this should be the "type" format
			grant: /^[a-z0-9-]+$/ // this should be the name format !
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
			compile(schema) {
				return (data) => Number.isInteger(NP.divide(data, schema));
			},
			errors: false,
			metaSchema: {
				type: "number",
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
			onCreateAjv: (ajv) => this.#setupAjv(ajv),
			options: {
				strictSchema: this.app.env == "dev" ? "log" : false,
				validateSchema: false,
				removeAdditional: "all",
				...Validation.AjvOptions
			}
		});
	}
	#createSettings(opts) {
		return {
			strictSchema: this.app.env == "dev" ? "log" : false,
			validateSchema: true,
			removeAdditional: "all",
			invalidDefaults: 'log',
			...Validation.AjvOptions,
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
			type: 'string',
			errors: false,
			validate: function (schema, data, parentSchema, dataCxt) {
				if (data == null) return true;
				const parent = dataCxt.parentData;
				const name = dataCxt.parentDataProperty;
				const format = parentSchema.format;
				if (parentSchema.type == "string" && data === "") {
					if (parentSchema.default !== undefined) {
						parent[name] = parentSchema.default;
					} else if (parentSchema.nullable) {
						delete parent[name];
					}
					return true;
				}
				if (format != "date" && format != "time" && format != "date-time") return true;
				const d = new Date(data);
				if (Number.isNaN(d.getTime())) {
					parent[name] = null;
				} else {
					data = d.toISOString();
					if (format == "date") parent[name] = data.split('T').shift();
					else if (format == "time") parent[name] = data.split('T').pop();
					else if (format == "date-time") parent[name] = data;
				}
				return true;
			}
		});
		return ajv;
	}

	validate(schema, data, inst) {
		if (!schema) return data;
		if (!inst.validate) {
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
			const messages = betterAjvErrors(schema, data, inst.validate.errors);
			throw new HttpError.BadRequest(messages);
		}
	}
};

// NB: this is mostly objection code, do not refactor
function jsonSchemaWithoutRequired(jsonSchema) {
	const subSchemaProps = ['anyOf', 'oneOf', 'allOf', 'not', 'then', 'else'];
	const discriminatorRequired = {};
	if (jsonSchema.discriminator && jsonSchema.discriminator.propertyName) {
		discriminatorRequired.required = [jsonSchema.discriminator.propertyName];
	}
	return Object.assign(
		omit(jsonSchema, ['required', ...subSchemaProps]),
		discriminatorRequired,
		...subSchemaProps.map((prop) => subSchemaWithoutRequired(jsonSchema, prop)),
		jsonSchema && jsonSchema.definitions
			? {
				definitions: Object.assign(
					...Object.keys(jsonSchema.definitions).map((prop) => ({
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
		} else {
			return {
				[prop]: jsonSchemaWithoutRequired(jsonSchema[prop]),
			};
		}
	} else {
		return {};
	}
}

function jsonSchemaArrayWithoutRequired(jsonSchemaArray) {
	return jsonSchemaArray.map(jsonSchemaWithoutRequired).filter(obj => !Object.isEmpty(obj));
}

function omit(obj, keys) {
	return Object.fromEntries(
		Object.entries(obj).filter(([key]) => !keys.includes(key))
	);
}
