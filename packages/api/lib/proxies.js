const { join } = require('node:path');

class MapProxy {
	constructor(context) {
		this.context = context;
	}
	set(obj, key, val) {
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
			return function () {
				const args = absolutePaths(Array.from(arguments), context);
				return Array.prototype[key].apply(arr, args);
			};
		}
		return Reflect.get(arr, key);
	}
}

class EltProxy {
	constructor(name, context) {
		this.name = name;
		this.context = context;
	}
	set(elt, key, val) {
		if (key == "scripts" || key == "stylesheets" || key == "resources") {
			val = new Proxy(absolutePaths(val, this.context), new AbsoluteProxy(this.context));
		}
		return Reflect.set(elt, key, val);
	}
	get(elt, key) {
		let val = Reflect.get(elt, key);
		if (["scripts", "stylesheets", "polyfills", "fragments"].includes(key)) {
			if (val == null) {
				val = [];
				Reflect.set(elt, key, val);
			}
		} else if (["resources", "properties", "csp", "filters", "intl"].includes(key)) {
			if (val == null) {
				val = {};
				Reflect.set(elt, key, val);
			}
		}
		return val;
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

Object.assign(exports, {
	AbsoluteProxy, EltProxy, MapProxy
});
