const { raw, ref } = require('objection');

exports = module.exports = function (opt) {
	return {
		name: 'event',
		service: function () { } // FIXME remove me ?
	};
};

exports.subscribe = function (req, data) {
	return Promise.all([
		All.run('settings.find', req, { email: data.email }),
		All.run('block.find', req, {
			type: 'event_date',
			id: data.event_date,
			parents: {
				type: 'event',
				first: true
			}
		})
	]).then(function ([settings, { item: eventDate }]) {
		if (req.user.id !== settings.id) {
			throw new HttpError.Unauthorized("Wrong user");
		}
		const parents = [
			{ type: 'settings', id: settings.id },
			{ type: 'event_date', id: eventDate.id }
		];
		// because search data.parents is for eager join, not relation
		return All.run('block.search', req, {
			type: 'event_reservation',
			parent: { parents }
		}).then(function (obj) {
			const maxSeats = eventDate.data.seats || eventDate.parent.data.seats || 0;
			let total = eventDate.data.reservations || 0;
			if (data.reservation.attendees) {
				data.reservation.seats = data.reservation.attendees.length;
			} else if (data.reservation.seats == null) {
				data.reservation.seats = 1;
			}
			if (data.reservation.seats > eventDate.parent.data.maxSeatsReservations) {
				throw new HttpError.BadRequest("Cannot reserve that much seats at once");
			}
			const price = eventDate.data.price || eventDate.parent.data.price || 0;
			const payment = {
				due: data.reservation.seats * price,
				method: data.reservation.payment.method,
				paid: 0
			};

			let blockMeth, resa;
			if (obj.items.length == 1) {
				resa = obj.items[0];
				total += -resa.data.seats;
				if (resa.data.payment) {
					payment.paid = resa.data.payment.paid;
				}
				blockMeth = 'block.save';
				resa = {
					id: resa.id,
					type: 'event_reservation',
					data: {
						contact: data.reservation.contact,
						attendees: data.reservation.attendees,
						payment: payment
					}
				};
			} else if (obj.items.length == 0) {
				blockMeth = 'block.add';
				resa = {
					type: 'event_reservation',
					data: {
						contact: data.reservation.contact,
						attendees: data.reservation.attendees,
						payment: payment
					},
					parents: parents,
					lock: { read: [`id-${req.user.id}`, 'scheduler'] }
				};
			} else {
				console.error("event.subscribe found out multiple subscriptions", data);
				throw new Error("Multiple subscriptions already exists");
			}
			total += resa.data.seats;
			if (Number.isNaN(total)) throw new HttpError.BadRequest("At least one seat must be reserved");
			if (maxSeats > 0 && total > maxSeats) {
				throw new HttpError.BadRequest("Cannot reserve this number of seats");
			}

			return All.run(blockMeth, req, resa).then(function (resa) {
				return eventDate.$query(req.trx).patch({
					'data:reservations': total
				}).then(function () {
					resa.parent = eventDate;
					return resa;
				});
			});
		});
	});
};

exports.subscribe.schema = {
	title: 'Subscribe',
	$action: 'write',
	required: ['event_date', 'reservation', 'email'],
	properties: {
		event_date: {
			title: 'Event Date',
			type: 'string',
			format: 'id'
		},
		email: {
			title: 'User Email',
			type: 'string',
			format: 'email'
		},
		reservation: {
			title: 'Reservation',
			type: 'object',
			properties: {
				payment: {
					title: 'Payment',
					type: 'object',
					properties: {
						method: {
							title: 'Payment method',
							type: 'string'
						}
					}
				},
				attendees: {
					title: 'Attendees',
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: true,
						properties: {
							name: {
								title: 'Name',
								type: 'string'
							}
						}
					},
					nullable: true
				},
				contact: {
					title: 'Contact',
					type: 'object',
					additionalProperties: true,
					properties: {
						name: {
							title: 'Name',
							type: 'string'
						},
						phone: {
							title: 'Phone',
							type: 'string',
							pattern: '^(\\(\\d+\\))? *\\d+([ .\\-]?\\d+)*$'
						}
					}
				},
				comment: {
					title: 'Comment',
					type: 'string'
				}
			}
		}
	}
};
exports.subscribe.external = true;

exports.unsubscribe = function (req, data) {
	return All.block.get(req, {
		type: 'event_reservation',
		id: data.reservation
	}).withGraphFetched('[parents(parentsFilter)]').modifiers({
		parentsFilter(q) {
			q.whereIn('type', ['settings', 'event_date']).select('block.id', 'block.type');
		}
	}).then(function (resa) {
		const paid = (resa.data.payment || {}).paid || 0;
		if (paid !== 0) throw new HttpError.BadRequest("Reservation has received payments");
		if (resa.data.seats !== 0) return All.run('event.subscribe', req, {
			parents: resa.parents,
			reservation: {
				attendees: []
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


exports.pay = function (req, data) {
	return All.block.get(req, {
		type: 'event_reservation',
		id: data.reservation
	}).then(function (resa) {
		if (!resa.data.payment) {
			resa.data.payment = {};
		}
		resa.data.payment.paid = data.amount;
		return All.run('block.save', req, resa);
	});
};
exports.pay.schema = {
	title: 'Pay',
	$action: 'write',
	required: ['reservation'],
	properties: {
		reservation: {
			title: 'Reservation',
			type: 'string',
			format: 'id'
		},
		amount: {
			title: 'Amount',
			type: 'number',
			default: 0
		}
	}
};
exports.pay.external = true;

exports.reservations = function ({ site, trx }, data) {
	// given an event_date, retrieve reservations, user settings and email
	return site.$relatedQuery('children', trx)
		.where('block.type', 'event_date')
		.where('block.id', data.id)
		.select().first().throwIfNotFound()
		.withGraphFetched(`[
		parents(event) as parent,
		children(reservations) as children
		.parents(settings) as settings
		.parents(user) as user
	]`).modifiers({
			event(q) {
				q.where('type', 'event').select();
			},
			reservations(q) {
				if (data.paid === true) {
					q.where(ref('data:payment.due'), ref('data:payment.paid'));
				} else if (data.paid === false) {
					q.whereNot(ref('data:payment.due'), ref('data:payment.paid'));
				}
				q.where(raw('jsonb_array_length(:attendees:) > 0', {
					attendees: ref('data:attendees')
				}));
				q.where('type', 'event_reservation').select();
			},
			settings(q) {
				q.where('type', 'settings').select();
			},
			user(q) {
				q.where('type', 'user').select(ref('data:email').as('email'));
			}
		}).then(function (eventDate) {
			eventDate.parent = eventDate.parent[0];
			eventDate.children.forEach(function (item) {
				// bad test data could ruin everything
				if (item.settings.length) item.settings = item.settings[0];
				else console.warn("no settings event date item", data.id, item.id);
				if (item.settings.user.length) item.settings.data.email = item.settings.user[0].email;
				else console.warn("no settings user for event date item", data.id, item.id);
				delete item.settings.user;
			});
			return { item: eventDate };
		});
};
exports.reservations.schema = {
	title: 'List reservations',
	$action: 'read',
	required: ['id'],
	properties: {
		id: {
			title: 'Event date',
			type: "string",
			format: 'id'
		},
		paid: {
			title: 'Payment',
			anyOf: [{
				const: false,
				title: 'Unpaid'
			}, {
				const: true,
				title: 'Paid'
			}, {
				const: null,
				title: 'All'
			}],
			default: null
		}
	}
};
exports.reservations.external = true;
