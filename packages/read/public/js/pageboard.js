Page.build(function(state) {
	var page = state.data.page;
	var blocks = buildBlocksMap(page);
	var pagecut = new Pagecut.Viewer();
	var dom = Pagecut.modules.id.from(pagecut, page.content.body, blocks);
	document.body.innerHTML = ""; // could use diff-dom or morphdom here
	document.body.appendChild(document.adoptNode(dom));

	function buildBlocksMap(block, blocks) {
		if (!blocks) blocks = [];
		Pagecut.modules.id.set(block); // seed cache as well
		if (block.children) block.children.forEach(function(item) {
			blocks[item.id] = item;
			buildBlocksMap(item, blocks);
		});
		return blocks;
	}
});

