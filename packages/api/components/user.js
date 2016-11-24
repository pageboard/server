var UserSchema = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = UserSchema;
}

UserSchema.name = "user";
UserSchema.required = ['email', 'password', 'name', 'surname'];
UserSchema.properties = {
	email: {
		type: 'string',
		format: 'email'
	},
	password: {
		type: 'string',
		minLength: 6
	},
	name: {
		type: 'string'
	},
	surname: {
		type: 'string'
	},
	grants: {
		type: 'array',
		items: {
			type: 'string'
		},
		uniqueItems: true,
		default: []
	}
};

