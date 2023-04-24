module.exports = class Upgrader {
	constructor({ site, from, to, idMap }) {
		this.idMap = Object.isEmpty(idMap) ? null : idMap;
		this.DomainBlock = site?.$modelClass;
		this.reverseMap = {};
		console.info("trying import from", from, "to", to);
		if (from && to) {
			try {
				this.module = require(`./from-${from}-to-${to}`);
				console.warn("found import", from, "to", to);
			} catch (ex) {
				if (ex.code != "MODULE_NOT_FOUND") {
					throw ex;
				}
			}
		}
	}
	beforeEach(block) {
		const id = this.idMap?.[block.id];
		if (id) {
			if (block.type == "user") {
				new HttpError.BadRequest(`Cannot change id of user ${block.id}`);
			}
			this.reverseMap[id] = block.id;
			block.id = id;
		}
		return block;
	}
	process(block, parent) {
		if (this.idMap && block.standalones) {
			block.standalones.forEach((id, i, arr) => {
				const mid = this.idMap[id];
				if (mid != null) arr[i] = mid;
			});
		}
		block = this.upgrade(block, parent);
		const schema = this.DomainBlock.schema(block.type);
		if (schema == null) {
			console.warn("Unknown type", block.type, block.id);
			block.type = '_';
			delete block.data;
			delete block.content;
		} else {
			fixContentProperties(
				schema.properties.content?.properties,
				block.content
			);
		}
		if (block.children) for (const child of block.children) {
			this.process(child, block);
		}
		this.afterEach(block);
		return block;
	}
	upgrade(block, parent) {
		const mod = this.module;
		if (!mod) return block;
		if (mod.any) {
			block = mod.any.call(this, block) ?? block;
		}
		if (mod[block.type]) {
			block = mod[block.type].call(this, block, parent) ?? block;
		}
		return block;
	}
	afterEach(block) {
		if (this.idMap) {
			this.copyContent(block);
			this.copyLock(block);
		}
	}
	copyContent(block) {
		if (!block.content) return;
		if (typeof block.content != "object") {
			console.error(block);
			throw new Error("content not object");
		}
		for (const [key, str] of Object.entries(block.content)) {
			if (!str) continue;
			block.content[key] = str.replaceAll(/block-id="([a-z0-9]+)"/g, (match, id) => {
				return `block-id="${this.idMap[id] ?? id}"`;
			});
		}
	}
	copyLock(block) {
		const locks = block.lock;
		if (!locks) return;
		locks.forEach((item, i) => {
			item = item.split('-');
			if (item.length != 2) return;
			const id = this.idMap[item[1]];
			if (id != null) {
				item[1] = id;
				locks[i] = item.join('-');
			}
		});
	}
};

function fixContentProperties(props, content) {
	// some blocks have been saved with a named key when they
	// actually had no named key
	if (props == null || content == null) return;
	const keys = Object.keys(props);
	if (keys.length != 1 || keys[0] !== "") return;
	const ckeys = Object.keys(content);
	if (ckeys.length != 1 || ckeys[0] === keys[0]) return;
	content[""] = content[ckeys[0]];
	delete content[ckeys[0]];
}
