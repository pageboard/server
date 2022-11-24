Pageboard Server
================

Install
-------

On linux, these packages are needed:

- postgresql database with unaccent extension
- libexiftool
- chrome or chromium
- libvips-dev
- libcurl-dev

See also `@pageboard/proxy`.

modules
-------

Modules define internal and external API:

- api
  Manages domain schemas.
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

- auth
  Authentication
  - auth.login: gets a validation url
  - auth.validate: validates that url and sets a jsonwebtoken in cookie

- cache
  Tag and scope-based directives for the proxy. Also sets peremption headers.

- statics
  Mounts and symlinks static files directories declared by pageboard modules.

- image
  Image thumbnailer and resizer/converter.

- git
  Listens to git webhooks json payloads on /.well-known/git and deploy accordingly.

- upload
  deals with files uploads
  - upload.parse
  - upload.store

- inspector
  Inspects any URL to get metadata about it.
  - inspector.get (internal api)

- mail
  renders a url to mail it to given recipient(s):
  - mail.send (internal api)

- prerender
  serves prerendered web pages, mails, and pdfs.
