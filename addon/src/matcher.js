/**
 * Finds where glossary symbols occur on a PDF page, using the reader's per-character
 * data: { c, rect: [x1, y1, x2, y2], fontSize, fontName, italic, spaceAfter, lineBreakAfter }
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

	// Whether char is set as a subscript or superscript of base: smaller, or vertically shifted
	function isScript(char, base) {
		let baseHeight = base.rect[3] - base.rect[1];
		return char.fontSize < base.fontSize * 0.92
			|| Math.abs(char.rect[1] - base.rect[1]) > baseHeight * 0.12;
	}

	function isAttached(char) {
		return !char.spaceAfter && !char.lineBreakAfter;
	}

	// A lone Latin letter is a symbol only when it's set in math type, which tells
	// the variable "a" from the article "a"
	function isMathLetter(chars, i) {
		let char = chars[i];
		if (char.italic || MATH_FONT.test(char.fontName || "")) return true;
		let standalone = (i == 0 || !isAttached(chars[i - 1])) && !isAttached(char);
		return standalone && /[B-HJ-Z]/.test(char.c);
	}

	function matchesAt(chars, norm, used, pattern, variant, i) {
		let base = chars[i];
		for (let j = 0; j < variant.length; j++) {
			let char = chars[i + j];
			if (used[i + j] || norm[i + j] !== variant[j].ch) return false;
			if (j > 0 && chars[i + j - 1].lineBreakAfter) return false;
			if (j > 0 && variant[j].script && !isScript(char, base)) return false;
		}

		// Not the tail of a word
		let previous = chars[i - 1];
		if (previous && isAttached(previous) && !isScript(base, previous)
				&& WORD_CHAR.test(norm[i - 1]) && WORD_CHAR.test(norm[i])) {
			return false;
		}
		if (pattern.hasScript) return true;

		// Not the head of a word
		let end = i + variant.length - 1;
		let next = chars[end + 1];
		if (next && isAttached(chars[end]) && !isScript(next, base)
				&& WORD_CHAR.test(norm[end]) && WORD_CHAR.test(norm[end + 1])) {
			return false;
		}
		if (variant.length == 1 && /[A-Za-z]/.test(variant[0].ch)) {
			return isMathLetter(chars, i);
		}
		return true;
	}

	/**
	 * @param {Object[]} chars - Characters of one page
	 * @param {Object[]} patterns - From compile()
	 * @return {{ index: Number, start: Number, end: Number, rect: Number[] }[]} - Occurrences in
	 *     reading order; `index` is the symbol's index, `rect` is in PDF coordinates
	 */
	function find(chars, patterns) {
		let norm = Array.from(chars, char => MathTidy.Notation.normalizeChar(char.c));
		let used = new Uint8Array(chars.length);
		let occurrences = [];
		for (let pattern of patterns) {
			for (let variant of pattern.variants) {
				for (let i = 0; i + variant.length <= chars.length; i++) {
					if (!matchesAt(chars, norm, used, pattern, variant, i)) continue;
					let end = i + variant.length - 1;
					let rect = [Infinity, Infinity, -Infinity, -Infinity];
					for (let k = i; k <= end; k++) {
						used[k] = 1;
						let r = chars[k].rect;
						rect = [
							Math.min(rect[0], r[0]), Math.min(rect[1], r[1]),
							Math.max(rect[2], r[2]), Math.max(rect[3], r[3]),
						];
					}
					occurrences.push({ index: pattern.index, start: i, end, rect });
					i = end;
				}
			}
		}
		return occurrences.sort((a, b) => a.start - b.start);
	}

	return { compile, find };
})();
