
exports.seed = function(knex, Promise) {
	return Promise.all([
		knex('relation').del(),
		knex('block').del()
	]).then(function() {
		return knex('block').insert({
			type: 'user',
			mime: 'application/json',
			data: {
				email: 'test@localhost.localdomain',
				password: 'password',
				name: 'Doe',
				firstname: 'John',
				grants: ['test']
			},
			permissions: {
				read: ['test'],
				add: ['test'],
				save: ['test'],
				del: ['test']
			}
		}, 'id');
	}).then(function(userIds) {
		// userIds[0] bears user id
	}).then(function() {
		return knex('block').insert({
			url: 'localhost',
			type: 'site',
			mime: '*/*',
			data: {
				name: 'Local site'
			}
		});
	});
};
