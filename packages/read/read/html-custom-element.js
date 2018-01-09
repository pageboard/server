// https://github.com/WebReflection/document-register-element#skipping-the-caveat-through-extends
class HTMLCustomElement extends HTMLElement {
	constructor(_) { return (_ = super(_)).init(), _; }
	init() { /* override as you like */ }
}
