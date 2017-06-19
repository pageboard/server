pageboard-static
================

Install and mount directories under three paths:

- /.pageboard/<directory>
mapped to <runtime>/pageboard/...
- /.files/<module>/<directory>
mapped to <runtime>/files/<hostname>/...
- /.uploads
mapped to <runtime>/uploads/<hostname>/...


API
---

`All.statics.install({domain, mounts})`

A mount is an object like:
```
{
  from: "some/path/dir",
  to: "


Example site object
-------------------

```
site: {
	data: {
		"dependencies": {
			pageboard-elements: "^1.0",
			pageboard-custom-site: "kapouer/pageboard-custom-site#1.0"
		},
	}
}
```

Each dependency can add directories by setting a "pageboard.directories" list
of relative paths in its package.json.

