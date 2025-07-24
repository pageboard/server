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

Cli options
-----------

To just run the server, do: `npx pageboard`

To list all API modules: `npx pageboard --help`

To show help for a method: `npx pageboard --help=<module.method>`

Most methods require a site to be set:
`npx pageboard --site=<id> module.method param=val`

Some methods dynamically check for a grant level. To set the highest grant level, do:
`npx pageboard --grant=root ...`

It is often handy to change database tenant (as defined in config):
`npx pageboard --database.tenant=dev ...`

Tests
-----

Tests need a symlink to pageboard/client to tests/fixtures/client:
`cd tests/fixtures; ln -s <path to pageboard/client> client`
