const { join } = require('node:path');
const polyfills = require.lazy('polyfill-library');
const toposort = require.lazy('toposort');
const polyfillDirectory = join(
	require.resolve('polyfill-library'),
	'../../polyfills/__dist'
);

module.exports = class PolyfillModule {
	static priority = -1;
	static name = 'polyfill';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	fileRoutes(app, server) {
		server.get(
			'/.files/polyfill.js',
			app.cache.tag('app-:site'),
			async (req, res, next) => {
				res.vary('User-Agent');
				const uaString = req.get('user-agent');
				const list = req.query.features?.split(',') ?? [];
				if (!list.length) throw new HttpError.BadRequest("No features requested");
				const features = Object.fromEntries(list.map(f => {
					return [f, { flags: ['gated'] }];
				}));
				const targetedFeatures = await polyfills.getPolyfills({ uaString, features });
				// FIXME add polyfill library version to cache key ?
				const cacheKey = 'polyfills-' + Object.keys(targetedFeatures).sort().join('-');
				res.set('User-Agent', cacheKey);
				const inputs = await this.flattenPolyfills(targetedFeatures);
				if (inputs.length == 0) {
					res.sendStatus(204);
					return;
				}
				// TODO before bundling, check we have not bundled it already
				// for this to work, we need to "mount" polyfillDirectory so we can pass hrefs to it
				const [output] = await this.app.statics.bundle(
					req.site, inputs, cacheKey + '.js'
				);
				res.sendFile(output);
			}
		);
	}

	async flattenPolyfills(targetedFeatures) {
		const warnings = {
			unknown: []
		};
		const featureNodes = [];
		const featureEdges = [];

		await Promise.all(
			Object.keys(targetedFeatures).map(async featureName => {
				const feature = targetedFeatures[featureName];
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
					feature.comment = featureName +
						", License: " +
						(polyfill.license || "CC0") +
						(feature.dependencyOf.size || feature.aliasOf.size
							? ' (required by "' +
							[...feature.dependencyOf, ...feature.aliasOf].join('", "') +
							'")'
							: "");
				}
			})
		);

		// Sort the features alphabetically, so ones with no dependencies
		// turn up in the same order
		featureNodes.sort((a, b) => a.localeCompare(b));
		featureEdges.sort(([, a], [, b]) => a.localeCompare(b));
		const sortedFeatures = toposort.array(featureNodes, featureEdges);
		return Promise.all(sortedFeatures.map(async featureName => {
			const polyfill = await polyfills.describePolyfill(featureName);
			// const { detectSource, baseDir } = polyfill;
			return join(polyfillDirectory, featureName, "raw.js");
		}));
	}
};
