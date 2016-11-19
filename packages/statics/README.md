pageboard-static
================

Mounts the content of directories listed in
`config.statics.mounts`
under the application's current working directory
`config.statics.root` public directory
by creating sub-directories and making files symlinks;
and serve them under the
`config.statics.prefix`
route prefix (default `/statics`).

The choice of prefixing all static files simplifies greatly configuration
of proxies.

