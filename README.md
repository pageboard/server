pageboard -- website editor
===========================

install
-------

Besides `npm install pageboard`:
- a postgresql 10 database
- exiftool (for inspector)
- webkitgtk 2.20 (for prerender)
- vips 8.6 (for image)

all of which are trivial to install on a debian or fedora operating system.

The server module requires more tools (iptables, nginx, memcached, upcache).


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
  Configure routes for tagging and scoping. See `server` below.

* statics  
  Mounts and symlinks static files directories declared by pageboard modules.

* image  
  Image thumbnailer and resizer/converter using sharpie -> sharp -> vips.

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
  the core bootstraping scripts for page rendering, uses `pagecut` for
  DOM output.

* write  
  the client libraries for edition, uses `pagecut` for block edition.
  
* pagecut  
  The core editor module, uses `prosemirror` to drive HTML wysiwyg editing.

* prerender  
  serves prerendered web pages, also used by mail and pdf modules.
  Uses `express-dom`.

* pdf  
  renders a web page to pdf using prerender module.

* server  
  the nginx/upcache/memcached system for highly-efficient userland caching
  and automatic SSL registration to letsencrypt (uses lua and resty modules)

* github-webhook  
  Allows continuous deployment of the module for each domain.

* polyfill  
  Installs polyfills required by other elements.
  
* elements-semantic-ui  
  The main set of elements.
  
* elements-gallery  
  portfolio/carousel combos.
  
* elements-google  
  Widgets installation (translate).

* site-semantic-ui  
  the default module for new domains, can be replaced by a custom npm-installable module.
