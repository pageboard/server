module.exports = class Upgrader {
	constructor(Block, opts = {}) {
		this.copy = Boolean(opts.copy);
		this.Block = Block;
		this.idMap = {};
		this.reverseMap = {};
		if (opts.from != opts.to && opts.from && opts.to) {
			try {
				this.module = require(`./from-${opts.from}-to-${opts.to}`);
			} catch (ex) {
				if (ex.code != "MODULE_NOT_FOUND") {
					throw ex;
				}
			}
			if (this.module) {
				console.warn("found import", opts.from, "to", opts.to);
			}
		}
	}
	get(id) {
		if (this.copy) return this.idMap[id];
		else return id;
	}
	beforeEach(block) {
		if (this.copy && block.type != "user") {
			const old = block.id;
			block.id = this.idMap[old] = this.Block.genIdSync();
			this.reverseMap[block.id] = old;
		}
		return block;
	}
	process(block) {
		if (this.copy) {
			block.children = (block.children || []).map(id => {
				const nid = this.idMap[id];
				if (nid == null) throw new Error("Cannot remap child: " + id);
				return nid;
			});
		}
		const mod = this.module;
		if (!mod) return block;
		try {
			if (mod.any) mod.any.call(this, block);
			if (mod[block.type]) block = mod[block.type].call(this, block) || block;
		} catch (ex) {
			console.error(ex.message);
			console.error(block);
			throw new Error("Upgrader error");
		}
		return block;
	}
	afterEach(block) {
		if (this.copy) {
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
		Object.entries(block.content).forEach(([key, str]) => {
			if (!str) return;
			let bad = false;
			block.content[key] = str.replaceAll(/block-id="(\w+)"/g, (match, id, pos, str) => {
				const cid = this.idMap[id];
				if (cid) {
					return `block-id="${cid}"`;
				}
				console.warn(`Cannot replace id: '${id}' in content
					${str.substring(pos - 5, pos + 35)}`);
				bad = true;
				return "block-strip";
			});
			if (bad) {
				block.content[key] = block.content[key].replaceAll(/<\w+ block-strip><\/\w+>/g, '');
			}
		});
	}
	copyLock(block) {
		const locks = block.lock && block.lock.read;
		if (!locks) return;
		locks.forEach((item, i) => {
			item = item.split('-');
			if (item.length != 2) return;
			const id = this.idMap[item[1]];
			if (id) item[1] = id;
			locks[i] = item.join('-');
		});
	}
};

