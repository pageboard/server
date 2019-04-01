pageboard-core -- Web pages content management
==============================================

This README is deprecated, see pageboard/pageboard README.md instead.

command-line usage
------------------

```
pageboard --listen 3000 --database "postgres://myuser@localhost/myappdb"
	--plugins pageboard-prerender --plugins ./plugins/myapp
```

pageboard uses `rc` to load configuration from files and cli arguments,
and plugins can act upon actions:

```
pageboard --data.url=/test \
	--data.template=test.html \
	--data.domain=test \
	page.add

pageboard --data.url=/test --data.domain=test page.get --connection.debug
```

or even

```
pageboard migrate seed
```


The `All` object
----------------

All useful functions are available through `All`:

- All.app (the express app)
- All.opt
- All.tag, All.scope, All.vary (the upcache plugin)
- All.api.Block
- All.api.Href
- All.api.DomainBlock(domain) -> promise
- All.install({domain, dependencies})
- All.objection, All.migrate
- All.page.get, All.site.add, All.user.save, All.page.save, etc..

A plugin must *not* populate `All` - it is supposed to be read-only, but
nothing actually prevents that. It simply has to use `exports` instead.

By default, `All` is a global object, but that can be disabled by setting
configuration option `global` to false.


Plugins
-------

`config.plugins` parameter is a list of modules names or paths.

A plugin is a module with set up like this:

```
module.exports = function(config) {
	config.stuff = Object.assign({ stuff: true }, config.stuff);
	return {
		service: init,
		name: 'test'
	};
}
exports.mystuff = function(thing) { /* ... */ }

function init(All) {
	All.app.get('/api/test', function(req, res, next) {
		exports.mystuff(req.query).then(function(data) {
			res.send(data);
		}).catch(next);
	});
}
```

Exported symbols are assigned to the global `All` object.
If `name` has been defined: `All.test.mystuff`,
and if it has not been defined: `All.mystuff`.

The `module.exports` function can return any of file, service, or view init functions.
Those functions can return a promise, are run one after another, first files,
then services, then views.

This allows express routes to be setup in predictable order, with separate
error handlers.


Sites, mounts, elements
-----------------------

`config.directories` and `config.elements` are arrays of paths that can be populated
by plugins when pageboard is started.

A site (with a domain) can also declare dependencies on npm modules, each of
which can contain a package.json with `pageboard.directories` and `pageboard.elements`
lists of relative paths.

Mounts declared this way are accessible through `/.files/<module>/<path>`
and are only accessible through the same domain.

Elements declared this way are loaded into a new Block per-domain model,
`All.api.DomainBlock(domain)` (returns a promise because it might need to install
the domain if the site was never installed before).

Elements entries can point to a directory, in which case all files with .js
extensions in that directory are loaded as elements.

pageboard-core is responsible for building the `directories` and `elements` arrays,
and then calls
```
All.statics.install({mounts, domain})
All.api.install({elements, directories, domain})
```


HttpError
---------

Is global, meaning you can `throw new HttpError.notFound(message)` anywhere you like.
See the [http-errors documentation](https://github.com/jshttp/http-errors).


configuration
-------------

Using `rc`.

Default values coming from package.json:
- name
- version
- plugins

From command-line or from http request's hostname
- site


Other configurations not set in package.json:
- global (wether All is available as a global or not)
- listen
- database (connection string)
  database.user
  database.dump (can be set to anything)
  database.dump.interval (in days)
  database.dump.dir (dir name in xdg data dir)
  database.dump.keep (in days)
- logFormat (for morgan)
- seeds, migrations (lists of directories)
- components (list of files)
- statics.root
- statics.favicon
- statics.mounts (list of directories to mount as statics public dirs)
- statics.maxAge (default maxAge for static files)
- scope.issuer (defaults to name)
- scope.maxAge (default maxAge for jsonwebtoken)
- inspector.providers (optional path to custom providers)
- prerender.stall, prerender.allow (and all express-dom settings)
- prerender.pool.max (and all pool settings)
- sharpie.q, sharpie.rs, sharpie.bg (and all sharpie settings)

