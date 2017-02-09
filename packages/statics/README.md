pageboard-static
================

Mounts the content of directories listed in
`config.statics.mounts`
under the application's current working directory
`config.statics.root` public directory
by creating sub-directories and making files symlinks;
and serve them under the
`config.statics.prefix`
route prefix (defaults to dirname of root directory `/public`).

Prefixing files makes it easier to configure proxies and caches, and also minimizes
the chances of URL collision between dynamic pages and files (which wouldn't
be catastrophic, but it's clearer for the user to know how URL are available).

