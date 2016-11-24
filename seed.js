var pageboard = require('pageboard-core');

var config = pageboard.config();

pageboard.init(config).then(function(All) {
	return All.user.add({data: {
		email: 'root@localhost.localdomain',
		password: 'password',
		name: 'John',
		surname: 'Doe',
		grants: ['all']
	}}).then(function(user) {
		return All.site.add({
			user: user.id,
			url: 'localhost',
			data: {
				name: 'Local site'
			}
		});
	}).then(function(site) {
		return Promise.all([
			All.page.add({
				site: 'localhost',
				url: '/error',
				template: 'error.html',
				data: {
					title: 'Error'
				}
			}),
			All.page.add({
				site: 'localhost',
				url: '/',
				template: 'index.html',
				data: {
					title: 'Home'
				}
			})
		]);
	}).then(function() {
		process.exit();
	});
}).catch(function(err) {
	console.error(err);
	process.exit(1);
});

