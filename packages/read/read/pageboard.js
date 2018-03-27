if (!window.Pageboard) window.Pageboard = {};

// https://github.com/WebReflection/document-register-element#skipping-the-caveat-through-extends
class HTMLCustomElement extends HTMLElement {
	constructor(_) { return (_ = super(_)).init(), _; }
	init() { /* override as you like */ }
}
HTMLCustomElement.define = function(name, cla) {
	if (!window.customElements.get(name)) window.customElements.define(name, cla);
};
