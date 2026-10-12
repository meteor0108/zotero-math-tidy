/* global Zotero, MozXULElement */

/**
 * Runs in the preferences window: UI language switching
 */
var MathTidyPrefs = {
	init() {
		document.getElementById("math-tidy-ui-language")
			.addEventListener("command", () => this.applyUILanguage());
	},

	applyUILanguage() {
		let language = Zotero.Prefs.get("extensions.math-tidy.uiLanguage", true);
		if (language != "en" && language != "ko") {
			language = Zotero.locale.startsWith("ko") ? "ko" : "en";
		}
		let file = `math-tidy-${language}.ftl`;
		for (let link of document.querySelectorAll('link[rel="localization"][href^="math-tidy-"]')) {
			if (link.getAttribute("href") != file) link.remove();
		}
		MozXULElement.insertFTLIfNeeded(file);
		// Swapping the file doesn't update what is already on screen
		let translated = document.querySelectorAll('[data-l10n-id^="math-tidy-"]');
		if (translated.length) document.l10n.translateElements([...translated]);
	},
};

// Pane scripts run in their own scope; the pane's inline handlers look the object up on the window
window.MathTidyPrefs = MathTidyPrefs;
// Link the strings before the pane's markup is inserted and translated
MathTidyPrefs.applyUILanguage();
