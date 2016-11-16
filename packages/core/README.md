pageboard -- Web pages content management
=========================================

command-line usage
------------------

```
# setup directories and symlinks
pageboard setup
# start express app
pageboard --listen 3000 --database "postgres://myuser@localhost/myappdb"
```

pageboard uses `rc` to load configuration from files and cli arguments.

setup can be called multiple times, it won't delete your application files.


directories
-----------

* db/models/  
  the database models and json schemas

* db/seeds/<NODE_ENV>/

* db/migrations/

* routes/  
  Each file exports function(app, api, config);
  app is an express instance,
  and config is a global object.
  Exports from other routes are accessible through api.<filename>.<method>.

* components/  
  the editor components  

* public/uploads/  
  where uploaded files go

* public/bundles/  
  where compiled assets go

* public/lang/  
  where translated html go


Makefile
--------

Usage:
```
NODE_ENV=<env> make install
```


How it works ?
--------------

Please read docs/


configuration
-------------

Using `rc`.

- name and version come from package.json
- listen
- database (connection string)
- logFormat (for morgan)
- statics.path (public/)
- statics.maxAge (default maxAge for static files)
- scope.issuer (defaults to name)
- scope.maxAge (default maxAge for jsonwebtoken)
- inspector.providers (optional path to custom providers)
- dom.stall, dom.allow (and all express-dom settings)
- dom.pool.max (and all pool settings)
- sharpie.q, sharpie.rs, sharpie.bg (and all sharpie settings)


