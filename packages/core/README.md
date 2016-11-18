pageboard-core -- Web pages content management
==============================================

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

Default values coming from package.json:
- name
- version
- plugins.services (list of requireable modules)
- plugins.files (list of requireable modules)
- plugins.views (list of requireable modules)

Other configurations not set in package.json:
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


