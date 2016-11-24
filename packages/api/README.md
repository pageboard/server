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

* component  
  all other components are children of a page (or grand-children, recursively).


Permissions
-----------

A user have grants, and blocks have permissions.
- add
- save
- del
- read

