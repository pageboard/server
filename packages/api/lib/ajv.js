const { AjvValidator } = require('objection');
const ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');


const ajvApiSettings = {
	$data: true,
	allErrors: true,
	validateSchema: true,
	ownProperties: true,
	coerceTypes: 'array',
	removeAdditional: false,
	nullable: true,
	formats: {
		singleline: /^[^\n\r]*$/,
		pathname: /^(\/[\w-.]*)+$/,
		page: /^((\/[a-zA-Z0-9-]*)+)$|^(\/\.well-known\/\d{3})$/,
		id: /^[A-Za-z0-9]+$/,
		name: /^\w+$/, // this should be the "type" format
		grant: /^[a-z0-9-]+$/ // this should be the name format !
	},
	invalidDefaults: 'log'
};
const validatorWithDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: 'empty'
})));

const validatorNoDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: false
})));

exports.createValidator = function () {
	return new AjvValidator({
		onCreateAjv: function (ajv) {
			AjvKeywords(ajv);
			ajv.addKeyword('coerce', {
				modifying: true,
				type: 'string',
				errors: false,
				validate: function (schema, data, parentSchema, path, parent, name) {
					if (data == null) return true;
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
			// otherwise the `format` keyword would validate before `coerce`
			// https://github.com/epoberezkin/ajv/issues/986
			const rules = ajv.RULES.types.string.rules;
			rules.unshift(rules.pop());
		},
		options: {
			$data: true,
			allErrors: true,
			validateSchema: false,
			ownProperties: true,
			coerceTypes: 'array',
			removeAdditional: "all",
			nullable: true,
			formats: ajvApiSettings.formats
		}
	});
};

exports.validate = function (schema, data, inst) {
	if (!schema) return data;
	if (!inst.validate) {
		if (schema.defaults === false) {
			inst.validate = validatorNoDefaults.compile(schema);
		} else {
			inst.validate = validatorWithDefaults.compile(schema);
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
};