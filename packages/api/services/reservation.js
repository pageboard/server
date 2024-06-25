module.exports = class ReservationService {
	static name = 'reservation';

	async add(req, data) {
		const { user } = req;
		const { date: event_date_id, email, ...reservation } = data;
		if (!reservation.attendees?.length) {
			throw new HttpError.BadRequest(
				"reservation.attendees must not be empty"
			);
		}
		const { item: eventDate } = await req.run('block.find', {
			id: event_date_id,
			type: 'event_date',
			parents: {
				type: 'event',
				first: true
			}
		});
		const { item: settings } = await req.run('settings.have', { email });

		if (user.id !== settings.id && !user.grants.includes('scheduler')) {
			throw new HttpError.Unauthorized("Wrong user");
		}
		const { parent: event } = eventDate;

		if (eventDateClosed(event, eventDate)) {
			throw new HttpError.BadRequest("Event date is closed");
		}

		const parents = [
			{ type: 'settings', id: settings.id },
			{ type: 'event_date', id: event_date_id }
		];
		// because search data.parents is for eager join, not relation
		const obj = await req.run('block.find', {
			type: 'event_reservation',
			parent: { parents }
		});
		if (obj.item) {
			obj.status = 409;
			obj.statusText = "User already has a reservation for this date";
			return obj;
		}
		if (reservation.attendees) {
			reservation.seats = reservation.attendees.length;
		} else if (reservation.seats == null) {
			reservation.seats = 1;
		}
		const total = (eventDate.data.reservations || 0) + reservation.seats;
		if (Number.isNaN(total)) {
			throw new HttpError.BadRequest("At least one seat must be reserved");
		}
		reservation.payment ??= {};

		if (reservation.seats > 0) {
			const maxSeats = eventDate.data.seats || event.data.seats || 0;
			if (maxSeats > 0 && total > maxSeats) {
				throw new HttpError.BadRequest("Cannot reserve this number of seats");
			}
			const maxSeatsRes = event.data.maxSeatsReservations;
			if (maxSeatsRes && reservation.seats > maxSeatsRes) {
				throw new HttpError.BadRequest("Cannot reserve that much seats at once");
			}
			reservation.payment.due = (eventDate.data.price || event.data.price || 0) * reservation.seats;
		} else {
			reservation.payment.paid = 0;
		}
		const { item: resa } = await req.run('block.add', {
			type: 'event_reservation',
			data: reservation,
			parents: parents,
			lock: [`id-${req.user.id}`, 'scheduler']
		});
		await eventDate.$query(req.trx).patchObject({
			type: eventDate.type,
			data: { reservations: total }
		});
		resa.parent = eventDate;
		return resa;
	}

	static add = {
		title: 'Add',
		$action: 'write',
		required: ['date', 'email'],
		properties: {
			date: {
				title: 'Event Date',
				type: 'string',
				format: 'id'
			},
			email: {
				title: 'User Email',
				type: 'string',
				format: 'email'
			},
			payment: {
				title: 'Payment',
				type: 'object',
				properties: {
					method: {
						title: 'Payment method',
						type: 'string'
					}
				},
				nullable: true
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
				nullable: true,
				properties: {
					name: {
						title: 'Name',
						type: 'string'
					},
					phone: {
						title: 'Phone',
						type: 'string',
						pattern: /^(\(\d+\))? *\d+([ .-]?\d+)*$/.source
					}
				}
			},
			comment: {
				title: 'Comment',
				type: 'string',
				nullable: true
			}
		}
	};

	async save(req, data) {
		const { user } = req;
		const { id, ...reservation } = data;
		if (!reservation.attendees?.length) {
			throw new HttpError.BadRequest(
				"reservation.attendees must not be empty"
			);
		}
		const { item: eventDate } = await req.run('block.find', {
			child: {
				id,
			},
			children: {
				type: 'event_reservation',
				first: true
			},
			type: 'event_date',
			parents: {
				type: 'event',
				first: true
			}
		});
		const { item: settings } = await req.run('block.find', {
			child: {
				id,
				type: 'event_reservation'
			},
			type: 'settings'
		});
		if (user.id !== settings.id && !user.grants.includes('scheduler')) {
			throw new HttpError.Unauthorized("Wrong user");
		}
		const { child: resa, parent: event } = eventDate;
		if (eventDateClosed(event, eventDate)) {
			throw new HttpError.BadRequest("Event date is closed");
		}
		if (reservation.attendees) {
			reservation.seats = reservation.attendees.length;
		} else if (reservation.seats == null) {
			reservation.seats = 1;
		}
		const total = (eventDate.data.reservations || 0) - resa.data.seats + reservation.seats;
		if (Number.isNaN(total)) {
			throw new HttpError.BadRequest("At least one seat must be reserved");
		}

		reservation.payment ??= {};

		if (reservation.seats > 0) {
			const maxSeats = eventDate.data.seats || event.data.seats || 0;
			if (maxSeats > 0 && total > maxSeats) {
				throw new HttpError.BadRequest("Cannot reserve this number of seats");
			}
			const maxSeatsRes = event.data.maxSeatsReservations;
			if (maxSeatsRes && reservation.seats > maxSeatsRes) {
				throw new HttpError.BadRequest("Cannot reserve that much seats at once");
			}
			reservation.payment.due = (eventDate.data.price || event.data.price || 0) * reservation.seats;
		} else {
			reservation.payment.due = 0;
		}
		reservation.payment.paid = resa.data.payment.paid;

		Object.assign(resa.data, reservation);

		await eventDate.$query(req.trx).patchObject({
			type: eventDate.type,
			data: { reservations: total }
		});
		return req.run('block.save', {
			id: resa.id,
			type: resa.type,
			data: resa.data,
			content: resa.content
		});
	}
	static save = {
		title: 'Save',
		$action: 'write',
		required: ['id'],
		properties: Object.assign({
			id: {
				title: 'Reservation id',
				type: 'string',
				format: 'id'
			}
		}, this.add.properties)
	};

	async del(req, { reservation: id }) {
		const { user, trx } = req;
		const { item: eventDate } = await req.run('block.find', {
			child: {
				id,
			},
			children: {
				type: 'event_reservation',
				first: true
			},
			type: 'event_date',
			parents: {
				type: 'event',
				first: true
			}
		});
		const { item: settings } = await req.run('block.find', {
			child: {
				id,
				type: 'event_reservation'
			},
			type: 'settings'
		});
		if (user.id !== settings.id && !user.grants.includes('scheduler')) {
			throw new HttpError.Unauthorized("Wrong user");
		}
		const { child: resa, parent: event } = eventDate;
		if (eventDateClosed(event, eventDate)) {
			throw new HttpError.BadRequest("Event date is closed");
		}
		const paid = (resa.data.payment || {}).paid || 0;
		if (paid !== 0) {
			throw new HttpError.BadRequest("Reservation has received payments");
		}
		if (resa.data.seats == 0) return resa;
		const total = (eventDate.data.reservations || 0) - resa.data.seats;
		await resa.$query(trx).delete();
		await eventDate.$query(trx).patchObject({
			type: eventDate.type,
			data: { reservations: total }
		});
		return {};
	}
	static del = {
		title: 'Delete',
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

	async pay(req, data) {
		const resa = await req.run('block.get', {
			type: 'event_reservation',
			id: data.reservation
		});
		if (!resa.data.payment) {
			resa.data.payment = {};
		}
		if (!resa.data.payment.due) resa.data.payment.due = 0;
		if (!resa.data.payment.paid) resa.data.payment.paid = 0;
		resa.data.payment.paid += data.amount;
		return req.run('block.save', {
			id: resa.id,
			type: resa.type,
			data: resa.data,
			content: resa.content
		});
	}
	static pay = {
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
				description: 'Positive or negative',
				type: 'number',
				default: 0
			}
		}
	};

	async search({ site, trx, ref, raw }, data) {
		// given an event_date, retrieve reservations, user settings and email
		const eventDate = await site.$relatedQuery('children', trx)
			.where('block.type', 'event_date')
			.where('block.id', data.id)
			.columns().first().throwIfNotFound()
			.withGraphFetched(`[
			parents(event) as parent,
			children(reservations) as children
			.parents(settings) as settings
			.parents(user) as user
		]`).modifiers({
				event(q) {
					q.where('type', 'event').columns();
				},
				reservations(q) {
					if (data.paid === true) {
						q.where(ref('data:payment.due'), ref('data:payment.paid'));
					} else if (data.paid === false) {
						q.whereNot(ref('data:payment.due'), ref('data:payment.paid'));
					}
					q.where(raw(`jsonb_array_length(coalesce(data['attendees'], '[]'::jsonb)) > 0`));
					q.where('type', 'event_reservation').columns();
				},
				settings(q) {
					q.where('type', 'settings').columns();
				},
				user(q) {
					q.where('type', 'user').select(ref('data:email').as('email'));
				}
			});
		eventDate.parent = eventDate.parent[0];
		const { children: items } = eventDate;
		delete eventDate.children;
		for (const item of items) {
			// bad test data could ruin everything
			if (!item.settings || !item.settings.length) {
				console.warn("no settings event date item", data.id, item.id);
				continue;
			}
			item.settings = item.settings[0];
			if (item.settings.user && item.settings.user.length) {
				item.settings.data.email = item.settings.user[0].email;
			} else {
				console.warn("no settings user for event date item", data.id, item.id);
			}
			delete item.settings.user;
		}
		eventDate.closed = eventDateClosed(eventDate.parent, eventDate);
		return { item: eventDate, items };
	}
	static search = {
		title: 'Search',
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
};


function eventDateClosed(event, eventDate) {
	const start = Date.parse(eventDate.data.slot.start);
	const opening = eventDate.data.opening ?? event.data.opening ?? Infinity;
	const closing = eventDate.data.closing ?? event.data.closing ?? 0;
	const openAt = start - opening * 3_600_000;
	const closeAt = start - closing * 3_600_000;
	const now = Date.now();
	return openAt <= now && now <= closeAt;
}
