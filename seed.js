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
				name: '@kapouer/local',
				domain: 'localhost',
				title: "Kapouer's local site"
			}
		});
	}).then(function() {
		process.exit();
	});
}).catch(function(err) {
	console.error(err);
	process.exit(1);
});

