const { join } = require('node:path');
const crypto = require.lazy('node:crypto');
const polyfills = require.lazy('@kapouer/polyfill-library');
const toposort = require.lazy('toposort');
const polyfillModuleDir = join(
	require.resolve('@kapouer/polyfill-library'),
	'../..'
);

module.exports = class PolyfillModule {
	static priority = -1;
	static name = 'polyfill';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
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
			}
		};
	}

	async fileRoutes(app, server) {

		server.get(
			'/.files/polyfill.js',
			app.cache.for({
				maxAge: this.app.opts.cache.files,
				immutable: true // eventually...
			}),
			async (req, res, next) => {
				try {
					const list = req.query.features?.split('+') ?? [];
					if (!list.length) throw new HttpError.BadRequest("No features requested");
					const features = await this.getFeatures(list);
					const inputs = features.map(name => {
						return this.polyfills[name]?.source ?? join(
							polyfillModuleDir, 'polyfills/__dist', name, "raw.js"
						);
					});
					if (inputs.length == 0) {
						res.sendStatus(204);
						return;
					}

					const hash = crypto.createHash('sha1');
					hash.update(list.join('+'));

					const [output] = await this.app.statics.bundle(req.site, {
						inputs,
						output: 'polyfill-' + hash.digest('base64').replaceAll(/=+$/g, '') + '.js',
						local: true,
						sourceMap: false
					});
					res.sendFile(output);
				} catch (err) {
					next(err);
				}
			}
		);
	}

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
			Array.from(flatList).map(async featureName => {
				const polyfill = await this.getPolyfill(featureName);
				if (!polyfill) {
					warnings.unknown.push(featureName);
				} else {
					featureNodes.push(featureName);
					if (polyfill.dependencies) {
						for (const depName of polyfill.dependencies) {
							const dep = await this.getPolyfill(depName);
							if (!dep) {
								warnings.unknown.push(dep);
							} else if (detectMap == Boolean(dep.detectSource)) {
								featureNodes.push(depName);
								featureEdges.push([depName, featureName]);
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
