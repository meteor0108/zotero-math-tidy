var MathTidy;

function install() {}

async function startup({ id, version, rootURI }) {
	Services.scriptloader.loadSubScript(rootURI + "src/math-tidy.js");
	Services.scriptloader.loadSubScript(rootURI + "src/notation.js");
	Services.scriptloader.loadSubScript(rootURI + "src/matcher.js");
	Services.scriptloader.loadSubScript(rootURI + "src/extractor.js");
	Services.scriptloader.loadSubScript(rootURI + "src/reader.js");
	Services.scriptloader.loadSubScript(rootURI + "src/section.js");

	MathTidy.init({ id, version, rootURI });
	for (let win of Zotero.getMainWindows()) {
		MathTidy.addToWindow(win);
	}
	await MathTidy.register();
}

function onMainWindowLoad({ window }) {
	MathTidy.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	MathTidy.removeFromWindow(window);
}

function shutdown() {
	MathTidy.unregister();
	for (let win of Zotero.getMainWindows()) {
		MathTidy.removeFromWindow(win);
	}
	MathTidy = undefined;
}

function uninstall() {}
