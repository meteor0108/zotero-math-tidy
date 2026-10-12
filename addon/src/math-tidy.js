MathTidy = {
	id: null,
	version: null,
	rootURI: null,

	PREF_PREFIX: "extensions.math-tidy.",
	PREF_PANE_ID: "math-tidy-prefpane",
	HTML_NS: "http://www.w3.org/1999/xhtml",

	// attachment ID -> promise of the analysis in progress
	jobs: new Map(),

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
	},

	log(msg) {
		Zotero.debug("Math Tidy: " + msg);
	},

	getPref(key) {
		return Zotero.Prefs.get(this.PREF_PREFIX + key, true);
	},

	/**
	 * UI language: "en" or "ko". The pref overrides Zotero's own language.
	 */
	getUILanguage() {
		let language = this.getPref("uiLanguage");
		if (language == "en" || language == "ko") return language;
		return Zotero.locale.startsWith("ko") ? "ko" : "en";
	},

	/**
	 * Link the Fluent file of the chosen UI language into the window, replacing the
	 * other language's. Both files define the same messages.
	 */
	applyUILanguage(win) {
		let doc = win.document;
		let file = `math-tidy-${this.getUILanguage()}.ftl`;
		for (let link of doc.querySelectorAll('link[rel="localization"][href^="math-tidy-"]')) {
			if (link.getAttribute("href") != file) link.remove();
		}
		win.MozXULElement.insertFTLIfNeeded(file);
		// Swapping the file doesn't update what is already on screen
		let translated = doc.querySelectorAll('[data-l10n-id^="math-tidy-"]');
		if (translated.length) doc.l10n.translateElements([...translated]);
	},

	addToWindow(win) {
		let doc = win.document;
		this.applyUILanguage(win);
		if (!doc.getElementById("math-tidy-stylesheet")) {
			let link = doc.createElementNS(this.HTML_NS, "link");
			link.id = "math-tidy-stylesheet";
			link.rel = "stylesheet";
			link.href = this.rootURI + "style.css";
			doc.documentElement.appendChild(link);
		}
	},

	removeFromWindow(win) {
		let doc = win.document;
		doc.getElementById("math-tidy-stylesheet")?.remove();
		for (let link of doc.querySelectorAll('link[rel="localization"][href^="math-tidy-"]')) {
			link.remove();
		}
	},

	async register() {
		await Zotero.PreferencePanes.register({
			pluginID: this.id,
			id: this.PREF_PANE_ID,
			src: this.rootURI + "preferences.xhtml",
			image: this.rootURI + "icons/icon.svg",
			scripts: [this.rootURI + "preferences.js"],
		});
		this._uiLanguageObserver = Zotero.Prefs.registerObserver(this.PREF_PREFIX + "uiLanguage", () => {
			for (let win of Zotero.getMainWindows()) {
				this.applyUILanguage(win);
			}
		}, true);
		this.Section.register();
		this.Reader.register();
	},

	unregister() {
		Zotero.Prefs.unregisterObserver(this._uiLanguageObserver);
		this.Section.unregister();
		this.Reader.unregister();
	},

	/**
	 * Language the meanings are written in: the pref if set, otherwise the UI language
	 */
	getLanguage() {
		let language = this.getPref("language").trim();
		if (language) return language;
		let uiLanguage = this.getPref("uiLanguage");
		if (uiLanguage == "en") return "English";
		if (uiLanguage == "ko") return "Korean";
		try {
			return new Intl.DisplayNames(["en"], { type: "language" }).of(Zotero.locale.split("-")[0]);
		}
		catch (e) {
			return "English";
		}
	},

	_cachePath(attachment) {
		return PathUtils.join(
			Zotero.DataDirectory.dir,
			"math-tidy",
			`${attachment.libraryID}_${attachment.key}.json`
		);
	},

	/**
	 * @return {Promise<Object|null>} - Saved glossary for the attachment, or null if not analyzed yet
	 */
	async load(attachment) {
		let path = this._cachePath(attachment);
		if (!(await IOUtils.exists(path))) return null;
		try {
			return await IOUtils.readJSON(path);
		}
		catch (e) {
			Zotero.logError(e);
			return null;
		}
	},

	async save(attachment, data) {
		let path = this._cachePath(attachment);
		await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true });
		await IOUtils.writeJSON(path, data);
	},

	/**
	 * Build the glossary for a PDF attachment with the configured LLM and save it.
	 * Concurrent calls for the same attachment share one run.
	 *
	 * @return {Promise<Object>} - { symbols: [{ symbol, meaning, where }], provider, model, ... }
	 */
	analyze(attachment) {
		let job = this.jobs.get(attachment.id);
		if (!job) {
			job = this._analyze(attachment).finally(() => this.jobs.delete(attachment.id));
			this.jobs.set(attachment.id, job);
		}
		return job;
	},

	async _analyze(attachment) {
		let provider = this.getPref("provider");
		let { symbols, model, input } = await this.LLM.extract(attachment, provider);
		let data = { version: 1, created: new Date().toISOString(), provider, model, input, symbols };
		await this.save(attachment, data);
		await this.Reader.refresh(attachment.id);
		return data;
	},

	async getText(attachment) {
		let text = await attachment.attachmentText;
		if (!text || !text.trim()) {
			throw new this.Error("math-tidy-error-no-text");
		}
		return text;
	},

	/**
	 * Error whose message is a Fluent ID, shown localized in the section
	 */
	Error: class extends Error {
		constructor(l10nID, l10nArgs) {
			super(l10nID);
			this.l10nID = l10nID;
			this.l10nArgs = l10nArgs;
		}
	},
};
