const URL = require('url');

exports = module.exports = function(opt) {
	return {
		name: 'event',
		service: function() {} // FIXME remove me ?
	};
};

exports.subscribe = function(site, data) {
	var [pSettings, pDate] = data.parents;
	if (pSettings.type != "settings") throw new Error("Wrong parents, expected settings, event_date");
	return All.run('block.find', site, Object.assign({}, pDate, {
		parents: {type: 'event', first: true}
	})).then(function(result) {
		var eventDate = result.item;
		// add event_reservation block with two parents: settings and event_date
		return All.run('block.search', site, {
			type: 'event_reservation',
			parents: {
				items: data.parents
			}
		}).then(function(obj) {
			var maxSeats = eventDate.data.seats || eventDate.parent.data.seats || 0;
			var total = eventDate.data.reservations || 0;

			var blockMeth, resa;
			if (obj.items.length == 1) {
				resa = obj.items[0];
				total += -resa.data.seats;
				blockMeth = 'block.save';
				resa = {
					id: resa.id,
					type: 'event_reservation',
					data: data.reservation
				};
			} else if (obj.items.length == 0) {
				blockMeth = 'block.add';
				resa = {
					type: 'event_reservation',
					data: data.reservation,
					parents: data.parents
				};
			} else {
				throw new Error("Two reservations using the same login");
			}
			total += resa.data.seats;
			if (isNaN(total)) throw new HttpError.BadRequest("Cannot reserve no seats");
			if (maxSeats > 0 && total > maxSeats) {
				throw new HttpError.BadRequest("Cannot reserve that much seats");
			}

			return All.run(blockMeth, site, resa).then(function(resa) {
				return eventDate.$query(site.trx).patch({
					'data:reservations': total
				}).then(function() {
					if (!data.url) return resa; // can't send confirmation email
					var urlObj = URL.parse(data.url, true);
					Object.assign(urlObj.query, {
						date: eventDate.id,
						reservation: resa.id
					});
					return All.run('mail.send', site, {
						url: URL.format(urlObj),
						to: pSettings.id
					});
				});
			});
		});
	});
};

exports.subscribe.schema = {
	title: 'Subscribe',
	$action: 'write',
	required: ['parents', 'reservation'],
	properties: {
		parents: {
			title: 'parents',
			type: 'array',
			items: {
				type: 'object'
			},
			$filter: {
				name: 'relation',
				from: 'service'
			}
		},
		reservation: {
			title: 'Reservation',
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
		},
		url: {
			title: 'Mail page',
			type: "string",
			format: "uri-reference",
			nullable: true,
			$helper: {
				name: 'page',
				title: 'Query',
				description: 'Values can be [$query.xxx]',
				query: true,
				type: 'mail'
			}
		}
	},
	parents: {
		type: 'array',
		items: [{
			type: 'object',
			properties: {
				type: {
					const: 'settings'
				},
				id: {
					title: 'user settings id',
					type: 'string',
					format: 'id'
				}
			}
		}, {
			type: 'object',
			properties: {
				type: {
					const: 'event_date'
				},
				id: {
					title: 'event date id',
					type: 'string',
					format: 'id'
				}
			}
		}]
	}
};
exports.subscribe.external = true;

exports.unsubscribe = function(site, data) {

};
exports.unsubscribe.schema = {
	title: 'Unsubscribe',
	$action: 'write',
	type: 'object',
	parents: exports.subscribe.parents,
	required: ['parents'],
	properties: {
		parents: {
			title: 'parents',
			type: 'array',
			$filter: 'relation'
		}
	}
};
exports.unsubscribe.external = true;
