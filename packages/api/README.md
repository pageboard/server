pageboard-api
=============


Configuration
-------------

* database
  a connection string, any parameter of which can be overriden by the
  following parameters

* connection.type
  connection.user
  connection.password
  connection.host
  connection.database

Commands
--------

* pageboard api.migrate


Services
--------

These services expose get, add, save, del functions.

* user
  identifies a user and its grants
  children of a user are sites

* site
  identifies a site containing pages, belongs to one or several users

* page
  a web page, belongs to a site

* block
  all other blocks are children of a page (or grand-children, recursively).


Permissions
-----------

login.verify can grant scopes to a requester by sending him a jwt cookie.
Elements have `$lock` property (a map)
blocks have `locks` property (a map).

If locks maps the '*' to something, it locks the whole block.
Otherwise keys are paths to block properties that must be locked.

The values are arrays (a string becomes [str]).

No locks means readable to everyone.
Empty locks list [] means forbidden for everyone.

Otherwise the requester must have one scope listed in the locks list.


See also auth module.

Debug
-----

DEBUG=pageboard:api
DEBUG=pageboard:sql
