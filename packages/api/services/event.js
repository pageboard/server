var ref = require('objection').ref;

exports = module.exports = function(opt) {
	return {
		name: 'event'
	};
};

exports.subscribe = function(site, data) {
	return All.run('settings.save', site, {
		email: data.email,
		data: {
			event: data.settings
		}
	}).then(function(settings) {
		return All.block.get(site, {
			id: data.id,
			type: 'event_date'
		}).then(function(eventDate) {
			var total = data.reservation.seats + eventDate.data.reservations;
			if (eventDate.data.seats > 0 && total > eventDate.data.seats) {
				throw new HttpError.BadRequest("Cannot reserve that much seats");
			}
			return eventDate.$query().patch({
				'data:reservations': total
			}).then(function() {
				return eventDate;
			});
		}).then(function(eventDate) {
			// add event_reservation block with two parents: settings and event_date
			return All.run('block.add', site, {
				type: 'event_reservation',
				data: data.reservation
			}).then(function(reservation) {
				return reservation.$relatedQuery('parents', site.trx).relate([
					eventDate._id,
					settings._id
				]).then(function() {
					return {
						date: eventDate,
						reservation: reservation
					};
				});
			});
		});
	});
};

exports.subscribe.schema = {
	required: ['id', 'email', 'settings', 'reservation'],
	properties: {
		id: {
			type: 'string'
		},
		email: {
			type: 'string',
			format: 'email'
		},
		settings: {
			type: 'object',
			properties: {
				allowNews: {
					title: 'Allow sending news',
					type: 'boolean',
					default: false
				},
				allowEmail: {
					title: 'Allow emails',
					type: 'boolean',
					default: false
				}
			}
		},
		reservation: {
			type: 'object',
			required: ['seats', 'name'],
			properties: {
				seats: {
					title: 'Number of reserved seats',
					type: 'integer',
					default: 1,
					minimum: 1
				},
				comment: {
					title: 'Comment',
					type: 'string'
				},
				name: {
					title: 'Name',
					type: 'string'
				},
				phone: {
					title: 'Phone',
					type: 'string',
					pattern: '^\\d+(\\s*\\.*-*\\d+)*$'
				}
			}
		}
	}
};
exports.subscribe.external = true;

exports.unsubscribe = function(site, data) {

};
exports.unsubscribe.schema = {
	type:'object'
};
exports.unsubscribe.external = true;
