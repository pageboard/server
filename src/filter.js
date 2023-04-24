module.exports = class ResponseFilter {
	#filters = [];

	run(req, obj) {
		const { item, items } = obj;
		if (!item && !items) {
			return this.#recurse(req, obj);
		}
		if (item) {
			obj.item = this.#recurse(req, item);
			if (!obj.item.type) delete obj.items;
		}
		if (obj.items) obj.items = obj.items.map(item => {
			return this.#recurse(req, item);
		}).filter(item => {
			return item && item.type;
		});
		return obj;
	}

	register(inst) {
		this.#filters.push(inst);
	}

	#recurse(req, item) {
		if (!item.type) return item;
		const { children, child, parents, parent, items } = item;
		if (children) {
			item.children = children.filter(item => {
				return this.#recurse(req, item);
			});
		}
		if (items) {
			item.items = items.filter(item => {
				return this.#recurse(req, item);
			});
		}
		if (parents) {
			item.parents = parents.filter(item => {
				return this.#recurse(req, item);
			});
		}
		if (child) {
			item.child = this.#recurse(req, child);
			if (item.child && !item.child.type) delete item.type;
		}
		if (parent) {
			item.parent = this.#recurse(req, parent);
			if (item.parent && !item.parent.type) delete item.type;
		}
		// old types might not have schema
		const schema = req.site.$schema(item.type) || {};
		for (const inst of this.#filters) {
			item = inst.filter(req, schema, item) ?? item;
		}
		return item;
	}

};

