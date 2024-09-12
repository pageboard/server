const { join } = require('node:path');
const crypto = require.lazy('node:crypto');
const polyfills = require.lazy('@kapouer/polyfill-library');
const toposort = require.lazy('toposort');
const utils = require.lazy('../../src/utils');

module.exports = class PolyfillModule {
	static priority = -1;
	static name = 'polyfill';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async init() {
		this.polyfills = {
			customElements: {
				source: join(require.resolve('@webreflection/custom-elements'), '../../index.js'),
				detectSource: `'customElements' in window`
			},
			customElementsBuiltin: {
				dependencies: ['customElements'],
				source: join(require.resolve('@webreflection/custom-elements-builtin'), '../../index.js'),
				// do not load this one if the other one is going to be loaded
				detectSource: `(function() {
					if (!('customElements' in window)) return true;
					try {
						const BR = class extends HTMLBRElement {};
						const is = 'test-pf-x-br';
						customElements.define(is, BR, { extends: 'br' });
						return document.createElement('br', {is}).outerHTML.indexOf(is) > 0;
					} catch(e) {
						return false;
					}
				})()`
			},
			ElementInternals: {
				source: require.resolve('element-internals-polyfill'),
				detectSource: `'ElementInternals' in window`
			},
			SubmitEvent: {
				source: require.resolve('event-submitter-polyfill'),
				detectSource: `'SubmitEvent' in window`
			},
			FormDataSubmitter: {
				dependencies: ['SubmitEvent'],
				source: require.resolve('formdata-submitter-polyfill'),
				detectSource: `(function() {
					try {
						new FormData(undefined, "");
						return false;
					} catch(e) {
						return true;
					}
				})()`
			},
			'Intl.NumberFormat.~locale.*': {
				detectSource: `self.Intl?.NumberFormat && function() {
					try {
						new Intl.NumberFormat(document.documentElement.lang, {
							style: "unit",
							unit: "byte"
						});
						return true;
					} catch(t) {
						return false;
					}
				}() && Intl.NumberFormat.supportedLocalesOf?.(document.documentElement.lang)?.length`
			},
			'Intl.DateTimeFormat.~locale.*': {
				detectSource: `self.Intl?.DateTimeFormat?.prototype?.formatRangeToParts && Intl.DateTimeFormat.supportedLocalesOf(document.documentElement.lang).length`
			},
			'Intl.RelativeTimeFormat.~locale.*': {
				detectSource: `self.Intl?.RelativeTimeFormat?.supportedLocalesOf?.(document.documentElement.lang)?.length`
			},
			'Promise.withResolvers': {
				source: require.resolve('@ungap/with-resolvers'),
				detectSource: `self.Promise?.withResolvers`
			}
		};
	}

	async fileRoutes(app, server) {
		server.get(
			'/@api/polyfill/bundle',
			app.cache.for({
				maxAge: '1 year',
				immutable: true
			}),
			async (req, res, next) => {
				try {
					const features = req.query.features?.split('!') ?? [];
					const output = await req.run('polyfill.bundle', { features });
					if (!output) return res.sendStatus(204);
					res.accelerate(output);
				} catch (err) {
					next(err);
				}
			}
		);
	}

	async bundle(req, { features }) {
		if (!features.length) throw new HttpError.BadRequest("No features requested");
		const list = await this.getFeatures(features);
		const polyfillModuleDir = join(
			require.resolve('@kapouer/polyfill-library'),
			'../..'
		);
		const inputs = list.map(name => {
			return this.polyfills[name]?.source ?? join(
				polyfillModuleDir, 'polyfills/__dist', name, "raw.js"
			);
		});
		if (inputs.length == 0) {
			return;
		}

		const [output] = await this.app.statics.bundle(req.site, {
			inputs,
			output: 'polyfill-' + utils.hash(features.join('!')) + '.js',
			local: true,
			sourceMap: false,
			force: true
		});
		return output;
	}
	static bundle = {
		title: 'Bundle',
		$private: true,
		required: ['features'],
		properties: {
			features: {
				title: 'Features',
				type: 'array',
				items: {
					type: 'string'
				}
			}
		}
	};

	async getPolyfill(name) {
		return this.polyfills[name] ?? polyfills.describePolyfill(name);
	}

	async getFeatures(targetedFeatures, detectMap = false) {
		const warnings = {
			unknown: []
		};
		const featureNodes = [];
		const featureEdges = [];

		const aliases = await polyfills.listAliases();
		const flatList = new Set();
		for (const name of targetedFeatures) {
			const alias = aliases[name];
			if (alias) {
				for (const name of alias) flatList.add(name);
			} else {
				flatList.add(name);
			}
		}

		await Promise.all(
			Array.from(flatList).map(async name => {
				const longLocale = /\.~locale\.[a-z]{2}(?:-[a-zA-Z]{2})?$/.test(name);
				if (longLocale) {
					name = name.replace(/(-[a-zA-Z]{2})$/, (m, p) => p.toUpperCase());
				}
				let polyfill = await this.getPolyfill(name);
				if (!polyfill && longLocale) {
					name = name.replace(/(-[a-zA-Z]{2})$/, "");
					polyfill = await this.getPolyfill(name);
				}
				if (!polyfill) {
					warnings.unknown.push(name);
				} else {
					featureNodes.push(name);
					if (polyfill.dependencies && detectMap) {
						for (let depName of polyfill.dependencies) {
							// some deps are set on a specific language, use our template instead
							depName = depName.replace(/(\.~locale\.)([a-z]{2})$/, '$1*');
							const dep = await this.getPolyfill(depName);
							if (!dep) {
								warnings.unknown.push(depName);
							} else if (dep.detectSource) {
								featureNodes.push(depName);
								featureEdges.push([depName, name]);
							}
						}
					}
				}
			})
		);

		// Sort the features alphabetically, so ones with no dependencies
		// turn up in the same order
		featureNodes.sort((a, b) => a.localeCompare(b));
		featureEdges.sort(([, a], [, b]) => a.localeCompare(b));
		const sortedFeatures = toposort.array(featureNodes, featureEdges);
		if (warnings.unknown.length) {
			console.warn("Unknown polyfills:", ...warnings.unknown);
		}
		return Array.from(new Set(sortedFeatures));
	}

	async source(list) {
		let source = '{';
		const features = await this.getFeatures(list, true);
		await Promise.all(features.map(async name => {
			const polyfill = await this.getPolyfill(name);
			source += `"${name}": (${polyfill.detectSource.trim()}),`;
		}));
		source += '}';
		return source;
	}
};
