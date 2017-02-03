var pageboard = require('pageboard-core');

var config = pageboard.config();

pageboard.init(config).then(function(All) {
	return All.user.add({data: {
		email: 'root@localhost.localdomain',
		password: 'password',
		name: 'John Doe',
		nickname: 'guest',
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
				data: {
					title: 'Error',
					template: 'templates/error.html'
				}
			}),
			All.page.add({
				site: 'localhost',
				url: '/',
				data: {
					title: 'Home',
					template: 'templates/home.html'
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

