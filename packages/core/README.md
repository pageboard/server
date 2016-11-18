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

`plugins` parameter is a list of paths to requirable plugins.
A plugin can export three hard-coded functions:
- file
- service
- view

each of which receives `(app, api, config)` parameters.

First those functions are called, and the function they return will be
called after all plugins have been loaded, each list before another, in the
same order, with an error handler after each list.
- files
- services
- views

This allows express routes to be setup in predictable order,
and plugins to setup and share configurations, then initialize routes.


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

