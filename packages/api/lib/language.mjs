export const language = {
	title: 'Language',
	description: 'Global constants',
	properties: {
		title: {
			title: 'Title',
			type: 'string',
			format: 'singleline'
		},
		lang: {
			title: 'Language Code',
			description: 'RFC 5646 format',
			type: 'string',
			format: 'lang',
			nullable: true
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
			format: 'id'
		}
	}
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
