module.exports = function formPlugin(page) {
	page.on('idle', () => {
		return page.evaluate(() => {
			function setAttr(el, name, val) {
				if (val === undefined) {
					el.removeAttribute(name);
				} else {
					const attr = document.createAttribute(name);
					if (val !== null) attr.value = val;
					el.attributes.setNamedItem(attr);
				}
			}
			for (const form of document.forms) {
				for (const el of form.elements) {
					if (el.checked) {
						setAttr(el, 'checked', null);
					} else if (el.matches('select') && el.options) {
						for (const opt of el.options) {
							if (opt.selected) setAttr(el, 'selected', null);
						}
					} else if (el.matches('textarea')) {
						el.innerHTML = el.value;
					} else {
						setAttr(el, 'value', el.value);
					}
				}
			}
		});
	});
};
