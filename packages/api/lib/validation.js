const { AjvValidator } = require('objection');
const Ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');
const AjvFormats = require("ajv-formats");



module.exports = class Validation {
	#validatorWithDefaults;
	#validatorNoDefaults;

	static AjvOptions = {
		$data: true,
		allErrors: true,
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
		// otherwise the `format` keyword would validate before `coerce`
		// https://github.com/epoberezkin/ajv/issues/986
		const rules = ajv.RULES.types.string.rules;
		rules.unshift(rules.pop());
		return ajv;
	}
	createValidator() {
		return new AjvValidator({
			onCreateAjv: (ajv) => this.#setupAjv(ajv),
			options: Object.assign({
				strictSchema: this.app.env == "dev" ? "log" : false,
				validateSchema: false,
				removeAdditional: "all"
			}, Validation.AjvOptions),
		});
	}
	#createSettings(opts) {
		return Object.assign({
			strictSchema: this.app.env == "dev" ? "log" : false,
			validateSchema: true,
			removeAdditional: "all",
			invalidDefaults: 'log'
		}, Validation.AjvOptions, opts);
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
			const messages = inst.validate.errors.map((err) => {
				if (err.dataPath) return `${err.dataPath} ${err.message}`;
				else return err.message;
			}).join(',\n');
			throw new HttpError.BadRequest(messages);
		}
	}
};
