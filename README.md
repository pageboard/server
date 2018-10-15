pageboard server modules
========================

[bug reports and features requests for server modules must go here](https://github.com/pageboard/server/issues)

install
-------

Besides `npm install pageboard`:
- a postgresql 10 database
- exiftool (for inspector)
- webkitgtk 2.20 (for prerender)
- vips 8.6 (for image)

All of which are some apt or dnf away on debian or fedora operating systems.

New sites built to run within pageboard should depend on client modules, which
are maintained in the `@pageboard/client` module.

Pageboard also works best when served behind `@pageboard/proxy`.

dev install
-----------

First checkout all git submodules using `git submodules update`,
then install them and link them in node_modules using `make`.

modules
-------

* core  
  - provides `pageboard` client and application launcher
  - loads pageboard modules that define further cli api and http routes.

* api  
  Manages domain schemas and their npm module deployment.
  Manipulate blocks:
  - block.get/search/save/add/del
  - site.get/add/save/del
  - page.get/search/add/save/del
  - user.get/add/save/del
  
  Manipulate hrefs:
  - href.get/search/save/add/del
  and the matching HTTP REST api
  Each href stores metadata about it (using inspector or direct data about pages).
  
  Userland api for query/form elements, allows calling internal api (granted
  permissions).
  - search.query (GET)
  - form.query (GET)
  - form.submit (POST)

* auth  
  Authentication
  - auth.login: gets a validation url
  - auth.validate: validates that url and sets a jsonwebtoken in cookie

* cache  
  Tag and scope-based directives for the proxy. Also sets peremption headers.

* statics  
  Mounts and symlinks static files directories declared by pageboard modules.

* image  
  Image thumbnailer and resizer/converter using sharpie -> sharp -> vips.

* github-webhook  
  Listens to github json payloads /.api/github and deploy accordingly.

* upload  
  deals with files uploads
  /.api/upload (POST, no internal api)

* inspector  
  Inspects any URL to get metadata about it.
  - inspector.get (internal api)

* mail  
  renders a url to mail it to given recipient(s):
  - mail.send (internal api)

* read  
  bootstraps a page that uses @pageboard/client elements modules.

* prerender  
  serves prerendered web pages, also used by mail and pdf modules.
  Uses `express-dom`.

