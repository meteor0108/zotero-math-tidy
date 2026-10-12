/**
 * The PDF reader side of the glossary: reads the pages' character data that the
 * glossary is built from, shows a symbol's definition when it is hovered, and jumps
 * to a symbol's occurrences.
 *
 * The reader has no plugin API for any of this, so it reads the PDF view's internals
 * (_primaryView, _pdfPages, pointerEventToPosition).
 */
MathTidy.Reader = {
	// Zotero reader instance -> promise of its state (null if it isn't a PDF reader)
	_attached: new Map(),

	// PDFs up to this many pages are analyzed when opened; longer ones on request
	AUTO_ANALYZE_MAX_PAGES: 80,

	register() {
		// Fires for every reader once its UI is up
		Zotero.Reader.registerEventListener("renderToolbar", ({ reader }) => {
			this.attach(reader);
		}, MathTidy.id);
		for (let reader of Zotero.Reader._readers) {
			this.attach(reader);
		}
	},

	unregister() {
		for (let promise of this._attached.values()) {
			promise.then((state) => {
				if (!state) return;
				try {
					state.win.removeEventListener("mousemove", state.onMouseMove);
					state.win.removeEventListener("mouseout", state.onMouseOut);
					state.tooltip.remove();
				}
				catch (e) {
					// The reader was closed
				}
			});
		}
		this._attached.clear();
	},

	/**
	 * @return {Promise<Object|null>}
	 */
	attach(reader) {
		let promise = this._attached.get(reader);
		if (!promise) {
			// Forget readers that were closed
			for (let known of this._attached.keys()) {
				if (!Zotero.Reader._readers.includes(known)) this._attached.delete(known);
			}
			promise = this._attach(reader).catch((e) => {
				Zotero.logError(e);
				return null;
			});
			this._attached.set(reader, promise);
			promise.then(state => state && this._analyzeIfNew(state));
		}
		return promise;
	},

	async _attach(reader) {
		await reader._initPromise;
		let view = reader._internalReader?._primaryView;
		if (!view?._pdfPages || !view.pointerEventToPosition) return null;
		await view.initializedPromise;

		// The view lives in the reader's content window. Listeners and DOM nodes go
		// through the regular (Xray) wrapper; the view's own methods through `view`.
		let win = Components.utils.unwaiveXrays(view._iframeWindow);
		let state = {
			reader,
			view,
			win,
			symbols: [],
			patterns: [],
			// page index -> occurrences, or the promise of them
			pages: new Map(),
			// symbol index -> last occurrence jumped to
			cursors: new Map(),
			tooltip: this._createTooltip(win.document),
			lastMove: 0,
		};
		state.onMouseMove = event => this._handleMouseMove(state, event);
		state.onMouseOut = (event) => {
			if (!event.relatedTarget) this._hideTooltip(state);
		};
		win.addEventListener("mousemove", state.onMouseMove);
		win.addEventListener("mouseout", state.onMouseOut);
		await this._loadGlossary(state);
		return state;
	},

	// Build the glossary the first time a PDF is opened
	async _analyzeIfNew(state) {
		try {
			let attachment = Zotero.Items.get(state.reader.itemID);
			if (!attachment || state.analyzed || this.getPageCount(state) > this.AUTO_ANALYZE_MAX_PAGES) return;
			await MathTidy.analyze(attachment);
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	async _loadGlossary(state) {
		let attachment = Zotero.Items.get(state.reader.itemID);
		let data = attachment && await MathTidy.load(attachment);
		state.analyzed = !!data;
		state.bodyFont = data?.bodyFont;
		state.symbols = data?.symbols || [];
		state.patterns = MathTidy.Matcher.compile(state.symbols);
		state.pages.clear();
		state.cursors.clear();
	},

	/**
	 * Pick up a new analysis in the readers that show the attachment
	 */
	async refresh(attachmentID) {
		for (let [reader, promise] of this._attached) {
			if (reader.itemID != attachmentID) continue;
			let state = await promise;
			if (state) await this._loadGlossary(state);
		}
	},

	_getOccurrences(state, pageIndex) {
		let occurrences = state.pages.get(pageIndex);
		if (!occurrences) {
			let patterns = state.patterns;
			occurrences = this._getChars(state, pageIndex).then((chars) => {
				let found = MathTidy.Matcher.find(chars, patterns, state.bodyFont);
				// Unless the glossary changed meanwhile
				if (state.patterns === patterns) state.pages.set(pageIndex, found);
				return found;
			});
			state.pages.set(pageIndex, occurrences);
		}
		return occurrences;
	},

	getPageCount(state) {
		return state.view._iframeWindow.PDFViewerApplication.pdfDocument.numPages;
	},

	/**
	 * The state of the reader showing the attachment
	 *
	 * @param {Boolean} [open] - Open the PDF if no reader shows it
	 * @return {Promise<Object|null>}
	 */
	async getState(attachment, open) {
		let readers = Zotero.Reader._readers.filter(reader => reader.itemID == attachment.id);
		let selectedTabID = Zotero.getMainWindow()?.Zotero_Tabs?.selectedID;
		let reader = readers.find(reader => reader.tabID == selectedTabID) || readers[0];
		if (!reader && open) {
			await Zotero.Reader.open(attachment.id);
			reader = Zotero.Reader._readers.find(reader => reader.itemID == attachment.id);
		}
		return reader ? this.attach(reader) : null;
	},

	/**
	 * @return {Promise<Object[][]>} - The characters of every page
	 */
	async getAllChars(state) {
		let pages = [];
		for (let pageIndex = 0; pageIndex < this.getPageCount(state); pageIndex++) {
			pages.push(await this._getChars(state, pageIndex));
		}
		return pages;
	},

	async _getChars(state, pageIndex) {
		let { view } = state;
		let page = view._pdfPages[pageIndex];
		if (!page?.chars) {
			let contentWindow = view._iframeWindow;
			page = await contentWindow.PDFViewerApplication.pdfDocument.getPageData(
				Components.utils.cloneInto({ pageIndex }, contentWindow)
			);
		}
		// Copy what the matcher and extractor read out of the content objects
		return Array.from(page?.chars || [], char => ({
			c: char.c,
			rect: Array.from(char.rect),
			baseline: char.baseline,
			fontSize: char.fontSize,
			fontName: char.fontName,
			italic: char.italic,
			spaceAfter: char.spaceAfter,
			lineBreakAfter: char.lineBreakAfter,
			paragraphBreakAfter: char.paragraphBreakAfter,
		}));
	},

	_handleMouseMove(state, event) {
		let now = Date.now();
		if (now - state.lastMove < 40) return;
		state.lastMove = now;
		if (!state.patterns.length || event.buttons) {
			this._hideTooltip(state);
			return;
		}

		let position;
		try {
			position = state.view.pointerEventToPosition(event);
		}
		catch (e) {
			position = null;
		}
		let occurrences = position && this._getOccurrences(state, position.pageIndex);
		// Still being computed for this page; the next mouse move will have it
		if (!Array.isArray(occurrences)) {
			this._hideTooltip(state);
			return;
		}
		let [x, y] = position.rects[0];
		let hit = occurrences.find(({ rect }) => {
			return x >= rect[0] - 1 && x <= rect[2] + 1 && y >= rect[1] - 1 && y <= rect[3] + 1;
		});
		if (hit) {
			this._showTooltip(state, state.symbols[hit.index], event);
		}
		else {
			this._hideTooltip(state);
		}
	},

	_createTooltip(doc) {
		let tooltip = doc.createElementNS(MathTidy.HTML_NS, "div");
		tooltip.style.cssText = "position: fixed; z-index: 2147483647; display: none; max-width: 340px;"
			+ " padding: 6px 9px; border-radius: 6px; background: #1f2937; color: #f9fafb;"
			+ " font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);"
			+ " pointer-events: none;";
		doc.body.append(tooltip);
		return tooltip;
	},

	_showTooltip(state, entry, event) {
		let { tooltip, win } = state;
		let doc = win.document;
		if (state.shown !== entry) {
			state.shown = entry;
			let symbol = doc.createElementNS(MathTidy.HTML_NS, "span");
			symbol.style.cssText = "font-family: 'Cambria Math', 'STIX Two Math', serif; font-size: 1.15em;"
				+ " margin-inline-end: 8px;";
			MathTidy.Notation.render(doc, symbol, entry.symbol);
			let meaning = doc.createElementNS(MathTidy.HTML_NS, "span");
			MathTidy.Notation.renderExcerpt(doc, meaning, entry);
			tooltip.replaceChildren(symbol, meaning);
		}
		tooltip.style.display = "block";
		let { width, height } = tooltip.getBoundingClientRect();
		let left = Math.min(event.clientX + 12, win.innerWidth - width - 8);
		let top = event.clientY + 20;
		if (top + height > win.innerHeight - 8) top = event.clientY - height - 12;
		tooltip.style.left = Math.max(8, left) + "px";
		tooltip.style.top = Math.max(8, top) + "px";
	},

	_hideTooltip(state) {
		state.shown = null;
		state.tooltip.style.display = "none";
	},

	/**
	 * Show the symbol in the PDF: first where it is defined, then on each further call
	 * its next occurrence, wrapping around. Opens the PDF if it isn't open.
	 *
	 * @return {Promise<Boolean>} - False if the symbol wasn't found in the PDF's text
	 */
	async jump(attachment, symbolIndex) {
		let state = await this.getState(attachment, true);
		if (!state) return false;
		let { reader } = state;
		let show = async (pageIndex, start, rect) => {
			state.cursors.set(symbolIndex, { pageIndex, start });
			if (reader.tabID) Zotero.getMainWindow()?.Zotero_Tabs?.select(reader.tabID);
			await reader.navigate({ position: { pageIndex, rects: [rect] } });
		};

		let entry = state.symbols[symbolIndex];
		let cursor = state.cursors.get(symbolIndex);
		if (!cursor && entry?.rect) {
			await show(entry.pageIndex, entry.start, entry.rect);
			return true;
		}
		cursor ||= { pageIndex: 0, start: -1 };
		let pageCount = this.getPageCount(state);
		// Rest of the cursor's page, then the following pages, then around to the cursor's page again
		for (let step = 0; step <= pageCount; step++) {
			let pageIndex = (cursor.pageIndex + step) % pageCount;
			let occurrences = await this._getOccurrences(state, pageIndex);
			let next = occurrences.find((occurrence) => {
				return occurrence.index == symbolIndex && (step > 0 || occurrence.start > cursor.start);
			});
			if (!next) continue;
			await show(pageIndex, next.start, next.rect);
			return true;
		}
		return false;
	},
};
