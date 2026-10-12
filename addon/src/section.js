/**
 * "Symbols" section in the item pane, shown both in the library and next to the PDF reader
 */
MathTidy.Section = {
	_registeredID: null,

	// section body -> { attachment, data, busy, error, filter, token, setSectionSummary }
	_states: new WeakMap(),

	register() {
		let icon = MathTidy.rootURI + "icons/icon.svg";
		this._registeredID = Zotero.ItemPaneManager.registerSection({
			paneID: "math-tidy",
			pluginID: MathTidy.id,
			header: { l10nID: "math-tidy-section-header", icon },
			sidenav: { l10nID: "math-tidy-section-sidenav", icon },
			onItemChange: ({ item, setEnabled }) => {
				setEnabled(item.isRegularItem() || item.isPDFAttachment());
			},
			onRender: ({ doc, body }) => {
				this._build(doc, body);
			},
			onAsyncRender: props => this._render(props),
		});
	},

	unregister() {
		if (this._registeredID) {
			Zotero.ItemPaneManager.unregisterSection(this._registeredID);
			this._registeredID = null;
		}
	},

	_state(body) {
		let state = this._states.get(body);
		if (!state) {
			state = { attachment: null, data: null, busy: false, error: null, filter: "" };
			this._states.set(body, state);
		}
		return state;
	},

	_element(doc, tag, className, l10nID) {
		let element = doc.createElementNS(MathTidy.HTML_NS, tag);
		if (className) element.className = className;
		if (l10nID) doc.l10n.setAttributes(element, l10nID);
		return element;
	},

	_build(doc, body) {
		if (body.querySelector(".math-tidy")) return;
		let state = this._state(body);

		let root = this._element(doc, "div", "math-tidy");
		let toolbar = this._element(doc, "div", "math-tidy-toolbar");
		let analyze = this._element(doc, "button", "math-tidy-analyze", "math-tidy-analyze");
		analyze.addEventListener("click", () => this._run(body));
		let filter = this._element(doc, "input", "math-tidy-filter", "math-tidy-filter");
		filter.type = "search";
		filter.addEventListener("input", () => {
			state.filter = filter.value;
			this._renderList(body);
		});
		let settings = this._element(doc, "button", "math-tidy-settings", "math-tidy-settings");
		settings.addEventListener("click", () => {
			Zotero.Utilities.Internal.openPreferences(MathTidy.PREF_PANE_ID);
		});
		toolbar.append(analyze, filter, settings);

		root.append(
			toolbar,
			this._element(doc, "div", "math-tidy-status"),
			this._element(doc, "div", "math-tidy-list")
		);
		body.replaceChildren(root);
	},

	/**
	 * The PDF the glossary belongs to: the one open in the reader, the selected
	 * attachment, or the item's primary PDF
	 */
	async _resolveAttachment(item, win) {
		if (item.isPDFAttachment()) return item;
		if (!item.isRegularItem()) return null;
		let reader = Zotero.Reader.getByTabID(win.Zotero_Tabs?.selectedID);
		if (reader) {
			let open = Zotero.Items.get(reader.itemID);
			if (open && open.parentItemID == item.id && open.isPDFAttachment()) return open;
		}
		let best = await item.getBestAttachment();
		return best && best.isPDFAttachment() ? best : null;
	},

	async _render({ doc, body, item, tabType, setSectionSummary }) {
		this._build(doc, body);
		let state = this._state(body);
		let token = state.token = {};
		state.setSectionSummary = setSectionSummary;

		let attachment = await this._resolveAttachment(item, doc.defaultView);
		if (state.token !== token) return;
		if (state.attachment?.id !== attachment?.id) {
			Object.assign(state, { attachment, data: null, busy: false, error: null });
		}
		if (!attachment) {
			this._update(body);
			return;
		}
		// An analysis started from another pane (or before switching items) is still running
		if (MathTidy.jobs.has(attachment.id)) {
			this._run(body);
			return;
		}
		let data = await MathTidy.load(attachment);
		if (state.token !== token) return;
		state.data = data;
		this._update(body);
		// Not analyzed yet, but open in the reader, where it can be read right away
		if (!data && tabType == "reader" && await MathTidy.Reader.getState(attachment)) {
			if (state.token === token) this._run(body);
		}
	},

	async _run(body) {
		let state = this._state(body);
		let attachment = state.attachment;
		if (!attachment) return;
		let isCurrent = () => state.attachment?.id === attachment.id;

		state.busy = true;
		state.error = null;
		this._update(body);
		try {
			let data = await MathTidy.analyze(attachment);
			if (isCurrent()) state.data = data;
		}
		catch (e) {
			Zotero.logError(e);
			if (isCurrent()) state.error = e;
		}
		if (isCurrent()) {
			state.busy = false;
			if (body.isConnected) this._update(body);
		}
	},

	_update(body) {
		let doc = body.ownerDocument;
		let state = this._state(body);
		let { attachment, data, busy, error } = state;

		let analyze = body.querySelector(".math-tidy-analyze");
		analyze.disabled = busy || !attachment;
		doc.l10n.setAttributes(analyze, data ? "math-tidy-reanalyze" : "math-tidy-analyze");
		body.querySelector(".math-tidy-filter").hidden = !data?.symbols.length;

		let status = body.querySelector(".math-tidy-status");
		status.classList.toggle("math-tidy-error", !!error && !busy);
		if (!attachment) {
			doc.l10n.setAttributes(status, "math-tidy-status-no-pdf");
		}
		else if (busy) {
			doc.l10n.setAttributes(status, "math-tidy-status-analyzing");
		}
		else if (error) {
			if (error instanceof MathTidy.Error) {
				doc.l10n.setAttributes(status, error.l10nID, error.l10nArgs);
			}
			else {
				doc.l10n.setAttributes(status, "math-tidy-error-generic", { message: error.message });
			}
		}
		else if (!data) {
			doc.l10n.setAttributes(status, "math-tidy-status-empty");
		}
		else if (!data.symbols.length) {
			doc.l10n.setAttributes(status, "math-tidy-status-none");
		}
		else {
			doc.l10n.setAttributes(status, "math-tidy-status-count", { count: data.symbols.length });
		}

		state.setSectionSummary?.(data ? String(data.symbols.length) : "");
		this._renderList(body);
	},

	_renderList(body) {
		let doc = body.ownerDocument;
		let state = this._state(body);
		let list = body.querySelector(".math-tidy-list");
		// Keep each entry's index in the glossary, which is how the reader refers to symbols
		let entries = (state.data?.symbols || []).map((entry, index) => ({ entry, index }));
		let filter = state.filter.trim().toLowerCase();
		if (filter) {
			entries = entries.filter(({ entry }) => {
				return entry.symbol.toLowerCase().includes(filter) || entry.meaning.toLowerCase().includes(filter);
			});
		}

		let rows = entries.map(({ entry, index }) => {
			let row = this._element(doc, "div", "math-tidy-row", "math-tidy-row");
			let symbolCell = this._element(doc, "div", "math-tidy-symbol");
			MathTidy.Notation.render(doc, symbolCell, entry.symbol);
			let meaningCell = this._element(doc, "div", "math-tidy-meaning");
			MathTidy.Notation.renderExcerpt(doc, meaningCell, entry);
			let where = entry.where || (Number.isInteger(entry.pageIndex) ? "p. " + (entry.pageIndex + 1) : "");
			if (where) {
				let whereLabel = this._element(doc, "span", "math-tidy-where");
				whereLabel.textContent = where;
				meaningCell.append(" ", whereLabel);
			}
			// A sentence that only uses the symbol, shown because none defines it
			if (entry.definition === false) row.classList.add("math-tidy-usage");
			row.append(symbolCell, meaningCell);
			row.addEventListener("click", () => this._jump(body, index));
			return row;
		});
		list.replaceChildren(...rows);
	},

	/**
	 * Go to the symbol in the PDF; clicking again goes to its next occurrence
	 */
	async _jump(body, index) {
		let doc = body.ownerDocument;
		let state = this._state(body);
		let { attachment, data } = state;
		// Leave the click alone when it ends a text selection
		if (!attachment || !doc.defaultView.getSelection().isCollapsed) return;
		let found = false;
		try {
			found = await MathTidy.Reader.jump(attachment, index);
		}
		catch (e) {
			Zotero.logError(e);
		}
		if (!found && state.data === data && !state.busy && body.isConnected) {
			let status = body.querySelector(".math-tidy-status");
			doc.l10n.setAttributes(status, "math-tidy-status-not-found", { symbol: data.symbols[index].symbol });
		}
	},
};
