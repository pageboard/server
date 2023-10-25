const { join } = require('node:path');
const crypto = require.lazy('node:crypto');
const polyfills = require.lazy('polyfill-library');
const toposort = require.lazy('toposort');
const polyfillModuleDir = join(
	require.resolve('polyfill-library'),
	'../..'
);

module.exports = class PolyfillModule {
	static priority = -1;
	static name = 'polyfill';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
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
					const inputs = list.map(name => join(
						polyfillModuleDir, 'polyfills/__dist', name, "raw.js"
					));
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
	async getFeatures(targetedFeatures) {
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
				const polyfill = await polyfills.describePolyfill(featureName);
				if (!polyfill) {
					warnings.unknown.push(featureName);
				} else {
					featureNodes.push(featureName);
					if (polyfill.dependencies) {
						for (const depName of polyfill.dependencies) {
							if (depName in targetedFeatures) {
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
		const features = await this.getFeatures(list);
		await Promise.all(features.map(async name => {
			const polyfill = await polyfills.describePolyfill(name);
			source += `"${name}": (${polyfill.detectSource}),`;
		}));
		source += '}';
		return source;
	}
};
