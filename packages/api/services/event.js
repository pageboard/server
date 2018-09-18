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
		return All.run('block.find', site, {
			id: data.id,
			type: 'event_date',
			parents: {type: 'event', first: true}
		}).then(function(foundObj) {
			var eventDate = foundObj.data;
			var total = data.reservation.seats + (eventDate.data.reservations || 0);
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
		}).then(function(obj) {
			if (!data.url) return obj; // can't send confirmation email
			var date = obj.date;
			var event = date.parent;
			var resa = obj.reservation;
			return All.run('mail.send', site, {
				url: data.url,
				to: data.email,
				query: {
					title: event.data.title,
					venue: event.data.venue,
					begin: date.data.slot.start,
					end: date.data.slot.end,
					seats: resa.data.seats,
					name: resa.data.name,
					groups: event.data.groupsOnly
				}
			});
		});
	});
};

exports.subscribe.schema = {
	$action: 'write',
	required: ['id', 'email', 'settings', 'reservation'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		email: {
			type: 'string',
			format: 'email'
		},
		url: {
			title: 'email page template',
			anyOf: [{
				type: "null"
			}, {
				type: "string",
				format: "uri"
			}, {
				type: "string",
				format: "pathname"
			}],
		},
		settings: {
			type: 'object',
			default: {},
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
	$action: 'write',
	type:'object'
};
exports.unsubscribe.external = true;
