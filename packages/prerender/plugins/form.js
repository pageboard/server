module.exports = function formPlugin(page) {
	page.when('idle', function() {
		return page.run(function() {
			function setAttr(el, name, val) {
				if (val === undefined) {
					el.removeAttribute(name);
				} else {
					var attr = document.createAttribute(name);
					if (val !== null) attr.value = val;
					el.attributes.setNamedItem(attr);
				}
			}
			Array.from(document.forms).forEach(function(form) {
				Array.from(form.elements).forEach(function(el) {
					if (el.checked) setAttr(el, 'checked', null);
					else if (el.options) Array.from(el.options).forEach(function(opt) {
						if (opt.selected) setAttr(el, 'selected', null);
					});
					else if (el.matches('textarea')) el.innerHTML = el.value;
				});
			});
		});
	});
};
