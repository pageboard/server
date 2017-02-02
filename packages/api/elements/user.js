var User = {};

if (typeof exports === "object" && typeof module !== "undefined") {
	module.exports = User;
}

User.name = "user";
User.required = ['email', 'password', 'nickname', 'name'];
User.properties = {
	email: {
		type: 'string',
		format: 'email'
	},
	verification: {
		type: ['string', 'null']
	},
	password: {
		type: 'string'
	},
	nickname: {
		type: 'string'
	},
	name: {
		type: 'string'
	},
	picture: {
		type: 'string',
		format: 'uri'
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

