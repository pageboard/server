pageboard-core -- Web pages content management
==============================================

command-line usage
------------------

```
pageboard --listen 3000 --database "postgres://myuser@localhost/myappdb"
	--plugins pageboard-prerender --plugins ./plugins/myapp
```

pageboard uses `rc` to load configuration from files and cli arguments.


Plugins
-------

`config.plugins` parameter is a list of modules names or paths.


Such a module:
- is initialized immediately if `module.exports = function(config) {}`
- will be accessible through `modules.<name>`

The initialization function can return an object mapping any of `file`,
`service`, `view` keys to a function with signature `app, modules, config`,
and a `name` key for the canonical module name.
That function is a typed plugin and can return a promise.

For each plugin type (file, service, view) the list of plugins is called
in that order.

This allows express routes to be setup in predictable order, with separate
error handlers.


configuration
-------------

Using `rc`.

Default values coming from package.json:
- name
- version
- plugins


Other configurations not set in package.json:
- listen
- database (connection string)
- logFormat (for morgan)
- statics.mounts (list of directories to mount as statics public dirs)
- statics.maxAge (default maxAge for static files)
- scope.issuer (defaults to name)
- scope.maxAge (default maxAge for jsonwebtoken)
- inspector.providers (optional path to custom providers)
- dom.stall, dom.allow (and all express-dom settings)
- dom.pool.max (and all pool settings)
- sharpie.q, sharpie.rs, sharpie.bg (and all sharpie settings)

