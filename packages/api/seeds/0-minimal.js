
exports.seed = function(knex, Promise) {
	return Promise.all([
		knex('relation').del(),
		knex('block').del()
	]).then(function() {
		return knex('block').insert({
			type: 'user',
			mime: 'application/json',
			data: {
				email: 'test@eda.sarl',
				password: 'testtest',
				name: 'Testname',
				firstname: 'Testfirstname',
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

	}).then(function() {
		return knex('block').insert({
			url: '/test',
			type: 'site',
			mime: '*/*',
			data: {
				name: 'Test site'
			}
		});
	});
};
