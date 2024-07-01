export const language = {
	title: 'Language',
	description: 'Global constants',
	unique: ['lang'],
	properties: {
		lang: {
			title: 'Language Code',
			description: 'Two-letters code',
			type: 'string',
			format: 'lang'
		},
		translation: {
			title: 'Translation Code',
			description: 'Code used for translation API',
			type: 'string',
			format: 'id',
			nullable: true
		},
		tsconfig: {
			title: 'Text Search identifier',
			type: 'string',
			format: 'id',
			nullable: true
		}
	},
	contents: "text*"
};

export const content = {
	title: 'Content',
	properties: {
		name: {
			title: 'Name',
			type: 'string',
			format: 'name'
		},
		lang: {
			title: 'Language',
			type: 'string',
			format: 'lang'
		},
		text: {
			title: 'Text',
			type: 'string'
		},
		valid: {
			title: 'Valid',
			type: 'boolean',
			default: false
		}
	}
};
