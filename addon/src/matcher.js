/**
 * Finds where glossary symbols occur on a PDF page, using the reader's per-character
 * data: { c, rect: [x1, y1, x2, y2], baseline, fontSize, fontName, italic, spaceAfter, lineBreakAfter,
 * paragraphBreakAfter }
 */
MathTidy.Matcher = (function () {
	const MATH_FONT = /ital|obli|math|cmmi|cmsy|msbm|symbol/i;
	const WORD_CHAR = /[\p{L}\p{N}]/u;

	/**
	 * @param {{ symbol: String }[]} symbols
	 * @return {Object[]} - Patterns, longest first so that "τ_a" claims its characters before "τ"
	 */
	function compile(symbols) {
		let patterns = [];
		symbols.forEach(({ symbol }, index) => {
			let variants = MathTidy.Notation.variants(symbol);
			if (!variants.length) return;
			patterns.push({
				index,
				variants,
				length: variants[0].length,
				hasScript: variants[0].some(item => item.script),
			});
		});
		return patterns.sort((a, b) => b.length - a.length);
	}

	/**
	 * Page characters as matched against patterns: { char, norm, accent, spaceAfter,
	 * lineBreakAfter, rects }.
	 *
	 * A PDF stores "ω̂" as two characters, "ω" and a "ˆ" drawn over it (before or after
	 * it in the text). The accent is folded into the letter it sits on, so that "ω̂" and
	 * "ω" are different symbols.
	 */
	function buildItems(chars) {
		let Notation = MathTidy.Notation;
		let items = chars.map((char) => {
			let { base, accent } = Notation.splitAccent(char.c);
			return {
				char,
				norm: base,
				accent,
				spaceAfter: !!char.spaceAfter,
				lineBreakAfter: !!char.lineBreakAfter,
				paragraphBreakAfter: !!char.paragraphBreakAfter,
				rects: [char.rect],
			};
		});

		let folded = new Set();
		items.forEach((item, i) => {
			let accent = Notation.standaloneAccent(item.char.c);
			if (!accent) return;
			let rect = item.char.rect;
			// Horizontal overlap with a neighbor on the same line
			let overlap = (other) => {
				if (!other || folded.has(other)) return 0;
				let otherRect = other.char.rect;
				if (otherRect[3] < rect[1] || otherRect[1] > rect[3]) return 0;
				return Math.min(rect[2], otherRect[2]) - Math.max(rect[0], otherRect[0]);
			};
			let previous = items[i - 1];
			let next = items[i + 1];
			let letter = overlap(previous) >= overlap(next) ? previous : next;
			if (overlap(letter) < (rect[2] - rect[0]) * 0.5 || letter.accent) return;

			letter.accent = accent;
			letter.rects.push(rect);
			if (letter === previous) {
				letter.spaceAfter ||= item.spaceAfter;
				letter.lineBreakAfter ||= item.lineBreakAfter;
			}
			folded.add(item);
		});
		return items.filter(item => !folded.has(item));
	}

	// Whether char is set as a subscript or superscript of base: smaller, or vertically shifted
	function isScript(char, base) {
		let baseHeight = base.rect[3] - base.rect[1];
		return char.fontSize < base.fontSize * 0.92
			|| Math.abs(char.rect[1] - base.rect[1]) > baseHeight * 0.12;
	}

	function isAttached(item) {
		return !item.spaceAfter && !item.lineBreakAfter;
	}

	// The font most of the page is set in, i.e. its body text
	function getBodyFont(chars) {
		let counts = new Map();
		for (let { fontName } of chars) {
			counts.set(fontName, (counts.get(fontName) || 0) + 1);
		}
		let bodyFont;
		for (let [fontName, count] of counts) {
			if (bodyFont === undefined || count > counts.get(bodyFont)) bodyFont = fontName;
		}
		return bodyFont;
	}

	// A lone Latin letter is a symbol only when it's set in math type, which tells the
	// variable "a" from the article "a": a font other than the body text's (the bold
	// "x" of a vector as much as an italic "x"), and not part of a heading, an abstract
	// or an italic sentence, where a neighbor is a word in that same font
	//
	// With `strict`, a capital standing on its own in the body font doesn't count either.
	function isMathLetter(items, i, bodyFont, strict) {
		let { char } = items[i];
		let inSameFont = (other) => {
			return other && other.char.fontName === char.fontName && /\p{L}/u.test(other.norm);
		};
		if (inSameFont(items[i - 1]) || inSameFont(items[i + 1])) return false;
		if (char.italic || MATH_FONT.test(char.fontName || "")) return true;
		if (char.fontName && bodyFont && char.fontName !== bodyFont) return true;
		if (strict) return false;
		let standalone = (i == 0 || !isAttached(items[i - 1])) && !isAttached(items[i]);
		return standalone && /[B-HJ-Z]/.test(char.c);
	}

	function matchesAt(items, used, pattern, variant, i, bodyFont) {
		let base = items[i].char;
		for (let j = 0; j < variant.length; j++) {
			let item = items[i + j];
			if (used[i + j] || item.norm !== variant[j].ch || item.accent !== variant[j].accent) return false;
			// Stacked scripts ("M" with "e" above "i") can sit on "lines" of their own
			if (j > 0 && !variant[j].script && items[i + j - 1].lineBreakAfter) return false;
			if (j > 0 && variant[j].script && !isScript(item.char, base)) return false;
		}

		// Not the tail of a word
		let previous = items[i - 1];
		if (previous && isAttached(previous) && !isScript(base, previous.char)
				&& WORD_CHAR.test(previous.norm) && WORD_CHAR.test(items[i].norm)) {
			return false;
		}
		if (pattern.hasScript) return true;

		// Not the head of a word
		let end = i + variant.length - 1;
		let next = items[end + 1];
		if (next && isAttached(items[end]) && !isScript(next.char, base)
				&& WORD_CHAR.test(items[end].norm) && WORD_CHAR.test(next.norm)) {
			return false;
		}
		if (variant.length == 1 && !variant[0].accent && /[A-Za-z]/.test(variant[0].ch)) {
			return isMathLetter(items, i, bodyFont);
		}
		return true;
	}

	/**
	 * @param {Object[]} chars - Characters of one page
	 * @param {Object[]} patterns - From compile()
	 * @param {String} [bodyFont] - The document's body font, if known; otherwise the page's
	 * @return {{ index: Number, start: Number, end: Number, rect: Number[] }[]} - Occurrences in
	 *     reading order; `index` is the symbol's index, `rect` is in PDF coordinates
	 */
	function find(chars, patterns, bodyFont) {
		let items = buildItems(chars);
		bodyFont ||= getBodyFont(chars);
		let used = new Uint8Array(items.length);
		let occurrences = [];
		for (let pattern of patterns) {
			for (let variant of pattern.variants) {
				for (let i = 0; i + variant.length <= items.length; i++) {
					if (!matchesAt(items, used, pattern, variant, i, bodyFont)) continue;
					let end = i + variant.length - 1;
					let rect = [Infinity, Infinity, -Infinity, -Infinity];
					for (let k = i; k <= end; k++) {
						used[k] = 1;
						for (let r of items[k].rects) {
							rect = [
								Math.min(rect[0], r[0]), Math.min(rect[1], r[1]),
								Math.max(rect[2], r[2]), Math.max(rect[3], r[3]),
							];
						}
					}
					occurrences.push({ index: pattern.index, start: i, end, rect });
					i = end;
				}
			}
		}
		return occurrences.sort((a, b) => a.start - b.start);
	}

	return { compile, find, buildItems, isScript, isMathLetter, getBodyFont };
})();
