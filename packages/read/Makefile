pagecut := $(shell node -p "require('path').dirname(require.resolve('pagecut'))")
windowpage := $(shell node -p "require('path').dirname(require.resolve('window-page'))")
htmlimports := $(shell node -p "require('path').dirname(require.resolve('@webcomponents/html-imports'))")
dts := $(shell node -p "require('path').dirname(require.resolve('dom-template-strings'))")
agent := $(shell node -p "require('path').dirname(require.resolve('window-agent'))")

install:
	mkdir -p pagecut
	ln -sf ${pagecut}/dist/pagecut-viewer.js pagecut/viewer.js
	ln -sf ${pagecut}/dist/pagecut-editor.js pagecut/editor.js
	ln -sf ${pagecut}/dist/pagecut-id.js pagecut/id.js
	ln -sf ${pagecut}/dist/pagecut-menu.js pagecut/menu.js
	ln -sf ${pagecut}/dist/prosemirror-menu.css pagecut/prosemirror-menu.css
	ln -sf ${pagecut}/dist/prosemirror.css pagecut/prosemirror.css
	ln -sf ${pagecut}/dist/pagecut-menu.css pagecut/menu.css
	ln -sf ${pagecut}/dist/pagecut.css pagecut/pagecut.css

	ln -sf ${windowpage}/window-page.js read/
	ln -sf ${htmlimports}/html-imports.min.js read/
	ln -sf ${dts}/dom-template-strings.js read/
	ln -sf ${agent}/agent.js read/

