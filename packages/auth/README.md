# pageboard-auth


## permissions

Initial basic design

Database migration

```
table.jsonb('permissions').defaultTo('{"read": [], "add": [], "save": [], "del": []}');
```

Block-level permissions ?

```
		permissions: {
			type: 'object',
			properties: {
				read: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				add: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				save: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				del: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				}
			}
		}
```

or, much more simpler, a permission could be

```
		{
			type: 'object',
			properties: {
				name: { type: 'string'},
				read: { type: 'boolean'},
				add: { type: 'boolean'},
				save: { type: 'boolean'},
				del: { type: 'boolean'}
			}
		}
```
in a separate table with a block_permission, ref_permission tables for storing
the 1,n relations.

In which case we'd need to define permissions by groups.

Current API exposes blocks in two ways:
- single-use blocks, all under the same page
- shared blocks, reusable in multiple pages

However the query to get all page single and shared blocks is very simple,
and could be modified to extend to permissions (no permission == ok, and permissions
require a check).
Something like

SELECT block.* FROM block AS children, block AS user
WHERE children.parent_id = <id_page>
AND user.id = <id_user>
AND block.permissions->'read' @> user.grants;

The set of permissions used to limit access to a resource must be known for
the proxy cache to work (upcache-scope). This can be easily set in the response
header by grouping distinct permissions from all the children blocks.
Using tag+scope caching technique, varying permissions due to varying children
shouldn't be a problem either - when a page changes, its keys are invalidated
by tag, so new requests will get new sets of permissions.

Also permissions could be easier to manage in a separate table.



## How grants and permissions are managed in pageboard

In pageboard, a site belongs to users.

Pageboard grants: "grant" > "user" > "site" > "page" > "block".
All these grants are checked by the API - it is not possible to dynamically set
a permission matching one of these grants on any block.

A user can only set permissions from the list of its grants.

Optional feature:
Dynamic grants can be created by users (if they have "grant+write" grant), and
they allow one to dynamically add a permission on any block.


## How login / logout / register is managed in pageboard

A form must be created using blocks, and that form action must be /api/login
or /api/logout.
Similar things for registering a new user.

Default grants can be set in the register form block data.
A user with grant+write grant can give lower grants to other users.

For example, a user with "block" grant (who can only change page content),
can setup a "register user" form, but users created this way can only get
dynamic grants, so they won't be able to change anything in pageboard editor.

User-created users could be able to act upon their own parameters if a user
with page/block grant creates a form allowing a user to modify itself, for example.

All users have a default grant "user_<id>" allowing a user to keep things for
himself.




User grants ?

```
		grants: {
			type: 'array',
			items: {
				type: 'string'
			},
			uniqueItems: true,
			default: []
		}
```

This is a very simple way to store what grants, by name, a user have.
Each permission 
