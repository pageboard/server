module.exports = function(gaid) {
	return function iePlugin(page) {
		if (!gaid) return;
		page.when('idle', function(cb) {
			this.run(function(gaid, done) {
				var script = document.createElement('script');
				script.textContent = `
(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
})(window,document,'script','//www.google-analytics.com/analytics.js','ga');
ga('create', '${gaid}', 'auto');
ga('send', 'pageview');`;
				script.type = "text/plain";
				var last = Array.from(document.head.querySelectorAll('script')).pop();
				var text = document.createTextNode("\n\t");
				(last || document.head.lastElementChild).after(text);
				text.after(script);
				script.type = "text/javascript";
				done();
			}, gaid, cb);
		});
	};
};

