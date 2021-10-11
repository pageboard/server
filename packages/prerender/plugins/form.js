module.exports = function formPlugin(page) {
	page.when('idle', () => {
		return page.run(() => {
			function setAttr(el, name, val) {
				if (val === undefined) {
					el.removeAttribute(name);
				} else {
					const attr = document.createAttribute(name);
					if (val !== null) attr.value = val;
					el.attributes.setNamedItem(attr);
				}
			}
			Array.from(document.forms).forEach((form) => {
				Array.from(form.elements).forEach((el) => {
					if (el.checked) setAttr(el, 'checked', null);
					else if (el.matches('select') && el.options) Array.from(el.options).forEach((opt) => {
						if (opt.selected) setAttr(el, 'selected', null);
					});
					else if (el.matches('textarea')) el.innerHTML = el.value;
					else setAttr(el, 'value', el.value);
				});
			});
		});
	});
};
