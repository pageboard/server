
exports.seed = function(knex, Promise) {
	return Promise.all([
		knex('relation').del(),
		knex('block').del(),
		knex('site').del(),
		knex('user_permission').del(),
		knex('permission').del(),
		knex('user').del()
	]).then(function() {
		return knex('user').insert({
			email: 'test@eda.sarl',
			password: 'testtest',
			name: 'Testname',
			firstname: 'Testfirstname'
		}, 'id');
	}).then(function(userIds) {
		return knex('permission').insert({
			id: userIds[0],
			name: 'test'
		}, 'id').then(function(permissionIds) {
			return knex('user_permission').insert({
				user_id: userIds[0],
				permission_id: permissionIds[0],
				read: true,
				add: true,
				save: true,
				del: true
			});
		});
	}).then(function() {
		return knex('site').insert({
			domain: 'test', // there must be a permission with the same name
			name: 'Test site'
		});
	});
};
