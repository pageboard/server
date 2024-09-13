const { join } = require('node:path');
const { types: { isProxy } } = require('node:util');

class MapProxy {
	constructor(context) {
		this.context = context;
	}
	set(obj, key, val) {
		if (val == null) {
			console.warn("Do not set an element to null", key);
			return false;
		}
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const item = obj[key];
			for (const [k, v] of Object.entries(val)) {
				const vs = item[k];
				if (vs != null) {
					if (typeof v != "object") {
						if (v !== vs) {
							console.error("Overriding element property is not supported", key, k, v, vs, "in", this.context.path);
						}
					} else {
						item[k] = Object.assign(v, item[k]);
					}
				} else {
					item[k] = v;
				}
			}
			return false;
		}
		return Reflect.set(obj, key, val);
	}
}

class ArrayProxy {
	constructor(context) {
		this.context = context;
	}
	set(arr, key, val) {
		if (key >= arr.length || key == "length" && val == arr.length) {
			return Reflect.set(arr, key, val);
		}
		console.warn("Cannot set ArrayProxy", arr, this.context, key);
		return false;
	}
	get(arr, key) {
		if (['push'].includes(key)) return Reflect.get(arr, key);
		else return false;
	}
}

class MapArrayProxy {
	constructor(context) {
		this.context = context;
	}
	set(obj, key, val) {
		console.warn("Cannot set MapArrayProxy", this.context, key);
		return false;
	}
	get(obj, key) {
		let val = Reflect.get(obj, key);
		if (!isProxy(val)) {
			val = new Proxy(val ?? [], new ArrayProxy(this.context));
			Reflect.set(obj, key, val);
		}
		return val;
	}
}

class AbsoluteProxy {
	static create(context) {
		return new this(context);
	}
	constructor(context) {
		this.context = context;
	}
	set(arr, key, val) {
		if (typeof key == "number" && val != null) {
			val = absolutePaths(val, this.context);
			if (val.length == 1) val = val[0];
			else throw new Error(`Cannot set ${this.context}.${key} with ${val}`);
		}
		return Reflect.set(arr, key, val);
	}
	get(arr, key) {
		if (['push', 'unshift'].includes(key)) {
			const { context } = this;
			return function (...list) {
				const args = absolutePaths(list, context);
				return Array.prototype[key].apply(arr, args);
			};
		}
		return Reflect.get(arr, key);
	}
}

class EltProxy {
	constructor(context) {
		this.name = context.name;
		this.context = context;
	}
	set(elt, key, val) {
		console.warn("Cannot set", key, "of", elt.name);
		return false;
	}
	get(elt, key) {
		return Reflect.get(elt, key);
	}
}

function absolutePaths(list, context) {
	if (!list) return;
	if (typeof list == "string") list = [list];
	const obj = Array.isArray(list) ? null : {};
	const arr = Object.entries(list).map(([key, path]) => {
		if (path == null) {
			console.warn("null path", key, "in", context);
			return;
		}
		if (path.startsWith('/') || /^(http|https|data):/.test(path)) {
			// do nothing
		} else if (!context.mount) {
			console.error("Cannot mount", path, "from element defined in", context.path);
			return;
		} else {
			path = join(context.mount, path);
		}
		if (obj) obj[key] = path;
		else return path;
	});
	if (obj) return obj;
	else return arr.filter(x => Boolean(x));
}

function createEltProxy(elt, context) {
	elt.scripts = new Proxy(
		absolutePaths(elt.scripts ?? [], context),
		new AbsoluteProxy(context)
	);
	elt.stylesheets = new Proxy(
		absolutePaths(elt.stylesheets ?? [], context),
		new AbsoluteProxy(context)
	);
	elt.resources = new Proxy(
		absolutePaths(elt.resources ?? {}, context),
		new AbsoluteProxy(context)
	);
	elt.migrations = new Proxy(
		elt.migrations ?? {},
		new MapArrayProxy(context)
	);
	elt.polyfills ??= [];
	elt.fragments ??= [];
	elt.properties ??= {};
	elt.csp ??= {};
	elt.filters ??= {};
	return new Proxy(elt, new EltProxy(context));
}

Object.assign(exports, {
	createEltProxy, MapProxy
});
