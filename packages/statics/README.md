pageboard-static
================

Install and mount npm modules files under

<domain>/files/<module>/


API
---

`All.static.install(domain, dependencies)`

returns a promise, and takes a dependencies object in the same format as the one
in package.json.


Example site object
-------------------

```
site: {
	data: {
		"dependencies": {
			pageboard-elements: "^1.0",
			casta: "edasarl/casta"
		},
		"elements": [
			"/files/pageboard-elements/page.js",
			"/files/pageboard-elements/link.js",
			"/files/casta/elements/shutter.js"
		]
	}
}
```

Elements are added when initializing a page from read.html at route phase, so
that build can access those elements.

Elements themselves can declare ui scripts and stylesheets, which are loaded
into the page at the end of the build phase, so setup phase can run them.


