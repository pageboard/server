exports = module.exports = function(opt) {
	return {
		name: 'event',
		service: function() {} // FIXME remove me ?
	};
};

exports.subscribe = function(site, user, data) {
	var [pSettings, pDate] = data.parents;
	if (pSettings.type == "event_date" && pDate.type == "settings") {
		[pDate, pSettings] = data.parents;
	}
	if (pSettings.type != "settings") throw new Error("Wrong parents, expected settings, event_date");
	return All.run('block.find', site, Object.assign({}, pDate, {
		parents: {type: 'event', first: true}
	})).then(function(result) {
		var eventDate = result.item;
		// add event_reservation block with two parents: settings and event_date
		return All.run('block.search', site, {
			type: 'event_reservation',
			parent: {
				parents: data.parents // because search data.parents is for eager join, not relation
			}
		}).then(function(obj) {
			var maxSeats = eventDate.data.seats || eventDate.parent.data.seats || 0;
			var total = eventDate.data.reservations || 0;
			if (data.reservation.seats > eventDate.parent.data.maxSeatsReservations) {
				throw new HttpError.BadRequest("Cannot reserve that much seats at once");
			}
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
					parents: data.parents,
					lock: [`user-${user.id}`, 'scheduler']
				};
			} else {
				throw new Error("Two reservations using the same login");
			}
			total += resa.data.seats;
			if (isNaN(total)) throw new HttpError.BadRequest("Cannot reserve no seats");
			if (maxSeats > 0 && total > maxSeats) {
				throw new HttpError.BadRequest("Cannot reserve that much seats");
			}

			return All.run(blockMeth, site, user, resa).then(function(resa) {
				return eventDate.$query(site.trx).patch({
					'data:reservations': total
				}).then(function() {
					if (!data.url) return resa; // can't send confirmation email
					return site.trx.commit().then(function() {
						delete site.trx;
						var mail = {
							url: data.url,
							body: {
								date: eventDate.id,
								reservation: resa.id
							},
							to: pSettings.id
						};
						if (data.from) mail.from = data.from;
						return All.run('mail.send', site, mail);
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
					minimum: 0
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
		from: {
			title: 'From',
			description: 'User settings.id or email',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		url: { // TODO remove this - mails should be send by form "arrays of methods"
			title: 'Mail page',
			type: "string",
			format: "pathname",
			$helper: {
				name: 'page',
				type: 'mail'
			}
		},
		body: {
			title: 'Mail body',
			type: "object"
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

exports.unsubscribe = function(site, user, data) {
	return All.block.get(site, {
		type: 'event_reservation',
		id: data.reservation
	}).eager('[parents(parentsFilter)]', {parentsFilter: function(q) {
		q.whereIn('type', ['settings', 'event_date']).select('block.id', 'block.type');
	}}).then(function(reservation) {
		if (reservation.data.seats !== 0) return All.run('event.subscribe', site, user, {
			parents: reservation.parents,
			reservation: {
				name: `(${reservation.data.name})`,
				seats: 0
			}
		});
	});
};
exports.unsubscribe.schema = {
	title: 'Unsubscribe',
	$action: 'write',
	required: ['reservation'],
	properties: {
		reservation: {
			title: 'Reservation',
			type: 'string',
			format: 'id'
		}
	}
};
exports.unsubscribe.external = true;
