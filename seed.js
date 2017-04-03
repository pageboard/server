var pageboard = require('pageboard-core');

var config = pageboard.config();

pageboard.init(config).then(function(All) {
	return All.objection.Model.query().table('relation').del().then(function() {
		return All.Block.query().del();
	}).then(function() {
		return All.user.add({data: {
			email: 'root@localhost.localdomain',
			password: 'password',
			name: 'John Doe',
			nickname: 'guest',
			grants: ['all']
		}});
	}).then(function(user) {
		return All.site.add({
			user: 'root@localhost.localdomain',
			data: {
				url: 'localhost',
				name: 'Local site'
			}
		});
	}).then(function(site) {
		return All.page.add({
			site: site.data.url,
			data: {
				url: '/',
				title: 'Home'
			},
			content: {
				body: '<p>Welcome to Pageboard</p>'
			}
		});
	}).then(function(page) {

	}).then(function() {
		process.exit();
	});
}).catch(function(err) {
	console.error(err);
	process.exit(1);
});

