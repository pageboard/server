if (!window.Pageboard) window.Pageboard = {};

// this works in babel 6, see postinstall-js
class HTMLCustomElement extends HTMLElement {
	constructor(me) {
		me = super(me);
		me.init();
		return me;
	}
	init() {}
}
HTMLCustomElement.define = function(name, cla) {
	if (!window.customElements.get(name)) window.customElements.define(name, cla);
};
