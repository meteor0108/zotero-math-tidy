/* global Zotero, MozXULElement */

/**
 * Runs in the preferences window: UI language switching and the model dropdowns,
 * which are filled from each provider's model list API.
 */
var MathTidyPrefs = {
	PREFIX: "extensions.math-tidy.",
	PROVIDERS: ["anthropic", "openai", "gemini"],
	OPENAI_DEFAULT_BASE_URL: "https://api.openai.com/v1",

	init() {
		document.getElementById("math-tidy-ui-language")
			.addEventListener("command", () => this.applyUILanguage());
		this.showProvider();
		document.getElementById("math-tidy-provider")
			.addEventListener("command", () => this.showProvider());
		for (let provider of this.PROVIDERS) {
			this.fillModels(provider);
			this.refreshModels(provider, false);
		}
	},

	getPref(key) {
		return Zotero.Prefs.get(this.PREFIX + key, true);
	},

	applyUILanguage() {
		let language = this.getPref("uiLanguage");
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

	/**
	 * Show the API key and model fields of the selected provider only
	 */
	showProvider() {
		let selected = this.getPref("provider");
		for (let provider of this.PROVIDERS) {
			document.getElementById("math-tidy-provider-" + provider).hidden = provider != selected;
		}
	},

	getModels(provider) {
		let models = [];
		try {
			models = JSON.parse(this.getPref(provider + ".models"));
		}
		catch (e) {}
		// Keep the selected model selectable even if the list no longer has it
		let selected = this.getPref(provider + ".model");
		if (selected && !models.includes(selected)) models.unshift(selected);
		return models;
	},

	fillModels(provider) {
		let menulist = document.getElementById(`math-tidy-${provider}-model`);
		let popup = menulist.querySelector("menupopup");
		popup.replaceChildren();
		for (let model of this.getModels(provider)) {
			let item = document.createXULElement("menuitem");
			item.setAttribute("label", model);
			item.setAttribute("value", model);
			popup.append(item);
		}
		menulist.value = this.getPref(provider + ".model");
	},

	/**
	 * Fetch the provider's current models and refill the dropdown
	 *
	 * @param {Boolean} report - Show the outcome next to the button. Off for the
	 *     automatic refresh when the pane opens, which fails quietly without an API key.
	 */
	async refreshModels(provider, report) {
		let status = document.getElementById(`math-tidy-${provider}-status`);
		let setStatus = (id, args) => {
			if (report) document.l10n.setAttributes(status, id, args);
		};
		try {
			setStatus("math-tidy-pref-models-loading");
			let models = await this.fetchModels[provider].call(this);
			if (!models.length) throw new Error("empty model list");
			Zotero.Prefs.set(this.PREFIX + provider + ".models", JSON.stringify(models), true);
			this.fillModels(provider);
			setStatus("math-tidy-pref-models-loaded", { count: models.length });
		}
		catch (e) {
			Zotero.debug(`Math Tidy: could not list ${provider} models: ${e.message}`);
			if (e.noKey) setStatus("math-tidy-pref-models-no-key");
			else setStatus("math-tidy-pref-models-failed", { message: e.message });
		}
	},

	async getJSON(url, headers) {
		let response = await fetch(url, { headers });
		let json = await response.json().catch(() => null);
		if (!response.ok) {
			let error = json?.error;
			throw new Error((typeof error == "string" ? error : error?.message) || `HTTP ${response.status}`);
		}
		return json;
	},

	requireKey(provider) {
		let key = this.getPref(provider + ".apiKey").trim();
		if (!key) throw Object.assign(new Error("no API key"), { noKey: true });
		return key;
	},

	fetchModels: {
		async anthropic() {
			let json = await this.getJSON("https://api.anthropic.com/v1/models?limit=1000", {
				"x-api-key": this.requireKey("anthropic"),
				"anthropic-version": "2023-06-01",
			});
			return json.data.map(model => model.id);
		},

		async openai() {
			let baseURL = (this.getPref("openai.baseURL").trim() || this.OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
			let isOpenAI = baseURL == this.OPENAI_DEFAULT_BASE_URL;
			let key = isOpenAI ? this.requireKey("openai") : this.getPref("openai.apiKey").trim();
			let json = await this.getJSON(baseURL + "/models", key ? { Authorization: "Bearer " + key } : {});
			let models = json.data.map(model => model.id);
			if (isOpenAI) {
				// Chat models only: OpenAI's list also has embedding, audio and image models
				models = models.filter((id) => {
					return /^(gpt-|o\d|chatgpt-)/.test(id)
						&& !/audio|realtime|tts|transcribe|image|embedding|search|instruct|moderation/.test(id);
				});
			}
			return models.sort().reverse();
		},

		async gemini() {
			let json = await this.getJSON("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
				"x-goog-api-key": this.requireKey("gemini"),
			});
			return json.models
				.filter(model => model.supportedGenerationMethods?.includes("generateContent"))
				.map(model => model.name.replace(/^models\//, ""))
				.filter(id => id.startsWith("gemini-") && !/embedding|tts|image|audio|live/.test(id))
				.sort()
				.reverse();
		},
	},
};

// Pane scripts run in their own scope; the pane's inline handlers look the object up on the window
window.MathTidyPrefs = MathTidyPrefs;
// Link the strings before the pane's markup is inserted and translated
MathTidyPrefs.applyUILanguage();
