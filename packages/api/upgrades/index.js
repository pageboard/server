module.exports = class Upgrader {
	constructor({ site, idMap, excludes }) {
		this.idMap = Object.isEmpty(idMap) ? null : idMap;
		this.DomainBlock = site?.$modelClass;
		this.reverseMap = {};
		this.excludes = excludes;
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
		if (this.idMap && block.parents) {
			block.parents.forEach((id, i, arr) => {
				const mid = this.idMap[id];
				if (mid != null) arr[i] = mid;
			});
		}
		if (!block.type) console.error("block.type missing", block);
		if (this.excludes?.includes(block.type)) return;
		const schema = this.DomainBlock.schema(block.type);
		if (schema == null) {
			console.warn("Unknown type", block.type, block.id);
			return;
		} else {
			fixContentProperties(
				schema.properties.content?.properties,
				block.content
			);
			if (['page', 'pdf', 'mail'].includes(block.type)) {
				fixPageData(block);
			}
			if (block.type == "site") {
				fixSiteExtra(block);
			}
		}

		if (block.children) {
			block.children = block.children.filter(
				child => this.process(child, block)
			);
		}
		this.afterEach(block);
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
			block.content[key] = str.replaceAll(/block-id="([a-z0-9]{1,32})"/g, (match, id) => {
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

function fixPageData({ data, content }) {
	if (data.title != null) {
		content.title = data.title;
		delete data.title;
	}
	if (data.description != null) {
		content.description = data.description;
		delete data.description;
	}
}

function fixSiteExtra({ data }) {
	data.extra ??= {};
	for (const key of ['google_site_verification', 'google_tag_manager', 'google_analytics', 'linkedin']) {
		if (data[key] != null) data.extra[key] = data[key];
		delete data[key];
	}
	data.languages ??= [];
	if (data.lang && data.languages.length == 0) {
		data.languages.push(data.lang);
		delete data.lang;
	}
}
