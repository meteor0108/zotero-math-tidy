/**
 * Builds the glossary from the PDF itself, without any outside service: finds the
 * math symbols in the reader's character data and, for each, the sentence of the
 * paper that defines it ("where R is the rotation matrix", "we denote the world
 * frame as W").
 */
MathTidy.Extractor = (function () {
	const LETTER = /^[A-Za-zͰ-Ͽ]$/;
	const GREEK = /^[Ͱ-Ͽ]$/;
	const SCRIPT_CHAR = /^[A-Za-z0-9Ͱ-Ͽ+\-,()′*]$/;
	// Superscripts that are operations on a symbol, not part of its name: transpose, inverse, powers
	const OPERATION_SUPERSCRIPT = /^(?:T|⊤|-1|\d)$/;
	const MAX_SCRIPT_LENGTH = 10;
	// Longer sentences are cut to a window around the symbol
	const MAX_EXCERPT_LENGTH = 260;
	const ABBREVIATIONS = new Set(["fig", "figs", "eq", "eqs", "sec", "al", "vs", "etc", "ref", "refs", "tab", "no", "resp", "cf"]);
	const NOT_A_NOUN = new Set([
		"with", "that", "from", "when", "then", "than", "into", "over", "each", "every", "this",
		"these", "those", "both", "while", "such", "where", "which", "between", "using", "since",
		"because", "have", "has", "been", "also", "only", "given", "under", "about", "after",
		"before", "through", "there", "their", "them",
	]);

	// Stand in for the symbol being scored, and for the other symbols, in a sentence's text
	// (private-use characters, which no PDF text contains)
	const MARK = String.fromCharCode(0xE000);
	const OTHER = String.fromCharCode(0xE001);
	// "X, Y and Z are ...", seen from Y or Z: a list of symbols is defined together
	const LIST_SEPARATOR = "(?:\\s*,(?:\\s*and)?\\s*|\\s+and\\s+)";
	const LIST_BEFORE = new RegExp("(?:" + OTHER + LIST_SEPARATOR + ")+" + MARK, "gu");
	const LIST_AFTER = new RegExp(MARK + "(?:" + LIST_SEPARATOR + OTHER + ")+", "gu");
	const VERB = "(?:is|are|was|be|denotes?|represents?|indicates?|describes?|stands for|refers to|corresponds to)";
	// "X is the ...", "X ∈ SO(3) denotes ..."
	const DEFINED_AFTER = new RegExp(
		MARK + "(?:\\s*[∈⊂⊆:]\\s*[^\\s,;]{1,14})?\\s*,?\\s*(" + VERB + ")\\b(\\s+(?:the|a|an)\\b)?",
		"u"
	);
	// "where X", "let X", "denote the world frame as X", "is defined as X"
	const DEFINED_BEFORE = new RegExp(
		"\\b(?:where|let|denoted?(?: by| as)?|defined?(?: by| as)?|called|termed|namely|given by|written as)"
			+ "\\s+(?:(?:the|a|an|our)\\s+)?(?:[\\p{L}-]+\\s+){0,3}" + MARK,
		"iu"
	);
	const BARE_VERB = /^(?:is|are|was|be)$/;
	const EQUATED = new RegExp(MARK + "\\s*(?:=|:=|≜|≡)", "u");
	const NAMED_AS = new RegExp("\\bas\\s+" + MARK, "iu");
	// "the rotation matrix X"
	const NOUN_BEFORE = new RegExp("(\\p{Ll}{4,})\\s+" + MARK, "u");
	const DEFINITION_SCORE = 1.5;

	// How far a character's baseline is above (positive) or below the base's, in base heights
	function getShift(char, base) {
		let height = base.rect[3] - base.rect[1];
		if (Number.isFinite(char.baseline) && Number.isFinite(base.baseline)) {
			return (char.baseline - base.baseline) / height;
		}
		return (char.rect[1] - base.rect[1]) / height;
	}

	function isAdjacent(left, right) {
		if (left.lineBreakAfter || left.spaceAfter) return false;
		return right.char.rect[0] - left.char.rect[2] < left.char.fontSize * 0.25;
	}

	/**
	 * Symbols on a page: a math letter with its accent and sub/superscripts
	 *
	 * @return {{ start, end, notation, key }[]} - `start`/`end` index into items;
	 *     `notation` is the symbol as written there, `key` the symbol it is an instance of
	 */
	function findSymbols(items, bodyFont) {
		let { isScript, isMathLetter } = MathTidy.Matcher;
		let symbols = [];
		// A letter or digit on the same baseline, whatever its size: part of the same
		// word, as in small caps ("IEEE") or an identifier ("A0H8")
		let sameLevelLetter = (item, other) => {
			if (!other || !/^[\p{L}\p{N}]$/u.test(other.norm)) return false;
			return Math.abs(getShift(other.char, item.char)) < 0.05;
		};

		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			if (!LETTER.test(item.norm)) continue;
			let previous = items[i - 1];
			let next = items[i + 1];
			let baseEnd = i;
			if (item.norm == "Δ" && next && isAdjacent(item, next) && sameLevelLetter(item, next)) {
				// A difference: "Δt" is one symbol
				baseEnd = i + 1;
			}
			else {
				// A letter inside a word, or one of several letters written together
				if (previous && isAdjacent(previous, item) && sameLevelLetter(item, previous)) continue;
				if (next && isAdjacent(item, next) && sameLevelLetter(item, next)) continue;
			}

			let base = items.slice(i, baseEnd + 1).map(part => part.norm + part.accent).join("");
			let baseChar = item.char;
			// Whether a script is itself math, e.g. the "e" and "i" on an upright "F"
			let hasMathScript = false;
			let sub = "";
			let sup = "";
			let end = baseEnd;
			for (let j = baseEnd + 1; j < items.length && j - baseEnd <= MAX_SCRIPT_LENGTH; j++) {
				let script = items[j];
				let last = items[j - 1];
				if (!SCRIPT_CHAR.test(script.norm) || !isScript(script.char, baseChar)) break;
				// Right after the previous character, or back over the base for a superscript
				// above a subscript (which the PDF may put on a "line" of its own)
				let gap = script.char.rect[0] - last.char.rect[2];
				if (gap > baseChar.fontSize * 0.35 || gap < -baseChar.fontSize * 1.5) break;
				// Lowered below the base's baseline, or raised off it. Smaller text on the
				// same baseline is small caps, not a script.
				let shift = getShift(script.char, baseChar);
				if (shift < -0.05 && shift > -0.8) sub += script.norm + script.accent;
				else if (shift > 0.15 && shift < 1) sup += script.norm + script.accent;
				else break;
				hasMathScript ||= /\p{L}/u.test(script.norm) && script.char.fontName !== bodyFont;
				end = j;
			}
			// Punctuation after the symbol set at script size
			while (end > baseEnd && /^[,(]$/.test(items[end].norm)) {
				if (sub.endsWith(items[end].norm)) sub = sub.slice(0, -1);
				else if (sup.endsWith(items[end].norm)) sup = sup.slice(0, -1);
				end--;
			}

			// A letter in the body font is a symbol only if it carries math scripts
			if (!GREEK.test(item.norm) && !isMathLetter(items, i, bodyFont, true) && !hasMathScript) continue;

			let script = (text, mark) => (text ? `${mark}{${text}}` : "");
			symbols.push({
				start: i,
				end,
				notation: base + script(sub, "_") + script(sup, "^"),
				key: base + script(sub, "_") + script(OPERATION_SUPERSCRIPT.test(sup) ? "" : sup, "^"),
			});
			i = end;
		}
		return symbols;
	}

	/**
	 * @return {Number[][]} - [start, end] item ranges of the page's sentences
	 */
	function splitSentences(items, bodyFont, symbolAt) {
		let ranges = [];
		let start = 0;
		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			let ends = i == items.length - 1 || (item.paragraphBreakAfter && !symbolAt.inside[i + 1]);
			// A sentence starts with a capital, or with a symbol ("g is the gravity vector")
			if (!ends && /^[.?!]$/.test(item.norm) && (item.spaceAfter || item.lineBreakAfter)
					&& (/^\p{Lu}/u.test(items[i + 1].char.c) || symbolAt.start.has(i + 1))) {
				// Unless the period belongs to "Fig.", "et al." or "i.e."
				let word = "";
				for (let k = i - 1; k >= start && /\p{L}/u.test(items[k].norm); k--) {
					word = items[k].norm + word;
					if (k > start && !isAdjacent(items[k - 1], items[k])) break;
				}
				let isAbbreviation = ABBREVIATIONS.has(word.toLowerCase())
					|| (word.length == 1 && items[i - 1].char.fontName === bodyFont);
				ends = !isAbbreviation;
			}
			if (ends) {
				ranges.push([start, i]);
				start = i + 1;
			}
		}
		return ranges;
	}

	// Text of items[start..end] as read, with the symbol at markStart replaced by MARK
	// and every other symbol by OTHER
	function getText(items, start, end, markStart, symbolAt) {
		let text = "";
		for (let i = start; i <= end; i++) {
			let item = items[i];
			let symbol = symbolAt.start.get(i);
			if (symbol) {
				text += i == markStart ? MARK : OTHER;
				i = symbol.end;
				item = items[i];
			}
			else if (item.norm == "-" && item.lineBreakAfter) {
				// A word hyphenated across lines
				continue;
			}
			else {
				text += item.char.c;
			}
			if (item.spaceAfter || item.lineBreakAfter) text += " ";
		}
		return text;
	}

	/**
	 * How strongly a sentence reads as the definition of the marked symbol:
	 * DEFINITION_SCORE or more for a definition, 0 for a mere use, -1 for text that
	 * isn't a sentence (a figure's labels, a bare equation)
	 */
	function scoreSentence(text) {
		text = text.replace(LIST_BEFORE, MARK).replace(LIST_AFTER, MARK);
		let words = text.match(/\p{L}{3,}/gu) || [];
		// Prose has function words; a figure's labels read "Lidar frames Lidar keyframe"
		let functionWords = text.match(/\b(?:the|a|an|is|are|be|can|of|we|to|and|in|on|at|as|by|with|from|that|this|for)\b/gi) || [];
		if (words.length < 4 || functionWords.length < 2) return -1;
		let after = text.match(DEFINED_AFTER);
		// "X is the ..." and "X denotes ..." define X; a bare "X is added to ..." merely uses it
		if (after && (after[2] || !BARE_VERB.test(after[1]))) return after[2] ? 4 : 3;
		if (DEFINED_BEFORE.test(text)) return 3;
		if (EQUATED.test(text) || NAMED_AS.test(text)) return 2;
		let noun = text.match(NOUN_BEFORE);
		if (noun && !NOT_A_NOUN.has(noun[1])) return 1.5;
		return 0;
	}

	/**
	 * The sentence as displayed: text runs and { s: notation } for each symbol in it,
	 * with `t: 1` on the symbol the excerpt is for
	 */
	function buildExcerpt(items, [start, end], symbolAt, target) {
		let prefix = "";
		let suffix = "";
		if (end - start > MAX_EXCERPT_LENGTH) {
			// Cut at word boundaries around the symbol, never inside another symbol
			let isBoundary = (i) => {
				let previous = items[i - 1];
				return (previous.spaceAfter || previous.lineBreakAfter) && !symbolAt.inside[i];
			};
			let from = Math.max(start, Math.floor(target.start - MAX_EXCERPT_LENGTH * 0.45));
			while (from > start && from < target.start && !isBoundary(from)) from++;
			let to = Math.min(end, Math.floor(target.end + MAX_EXCERPT_LENGTH * 0.55));
			while (to < end && to > target.end && !isBoundary(to + 1)) to--;
			if (from > start) prefix = "… ";
			if (to < end) suffix = " …";
			start = from;
			end = to;
		}

		let parts = [];
		let text = prefix;
		for (let i = start; i <= end; i++) {
			let item = items[i];
			let symbol = symbolAt.start.get(i);
			if (symbol) {
				if (text) parts.push(text);
				text = "";
				parts.push(symbol === target ? { s: symbol.notation, t: 1 } : { s: symbol.notation });
				i = symbol.end;
				item = items[i];
			}
			else if (item.norm == "-" && item.lineBreakAfter) {
				continue;
			}
			else {
				// An accent folded into its letter comes back as a combining mark
				text += item.char.c + (item.rects.length > 1 ? item.accent : "");
			}
			if ((item.spaceAfter || item.lineBreakAfter) && i < end) text += " ";
		}
		text += suffix;
		if (text) parts.push(text);
		return parts;
	}

	function unionRect(items, start, end) {
		let rect = [Infinity, Infinity, -Infinity, -Infinity];
		for (let i = start; i <= end; i++) {
			for (let r of items[i].rects) {
				rect = [
					Math.min(rect[0], r[0]), Math.min(rect[1], r[1]),
					Math.max(rect[2], r[2]), Math.max(rect[3], r[3]),
				];
			}
		}
		return rect;
	}

	/**
	 * @param {Object[][]} pages - The characters of each page, as the reader extracts them
	 * @return {{ bodyFont: String, symbols: Object[] }} - Glossary entries in order of first
	 *     appearance: { symbol, parts, meaning, definition, pageIndex, start, rect, count }
	 */
	function extract(pages) {
		let bodyFont = MathTidy.Matcher.getBodyFont(pages.flat());
		let entries = new Map();
		pages.forEach((chars, pageIndex) => {
			let items = MathTidy.Matcher.buildItems(chars);
			let symbols = findSymbols(items, bodyFont);
			if (!symbols.length) return;
			let symbolAt = { start: new Map(), inside: new Uint8Array(items.length) };
			for (let symbol of symbols) {
				symbolAt.start.set(symbol.start, symbol);
				symbolAt.inside.fill(1, symbol.start + 1, symbol.end + 1);
			}

			let sentences = splitSentences(items, bodyFont, symbolAt);
			let sentenceIndex = 0;
			for (let symbol of symbols) {
				while (sentences[sentenceIndex][1] < symbol.start) sentenceIndex++;
				let sentence = sentences[sentenceIndex];
				let score = scoreSentence(getText(items, sentence[0], sentence[1], symbol.start, symbolAt));

				let entry = entries.get(symbol.key);
				if (!entry) {
					entry = { symbol: symbol.key, count: 0, score: -Infinity };
					entries.set(symbol.key, entry);
				}
				entry.count++;
				// The best-scoring sentence, the earliest among equals
				if (score > entry.score) {
					Object.assign(entry, { score, pageIndex, items, sentence, symbolAt, target: symbol });
				}
			}
		});

		let symbols = [];
		for (let entry of entries.values()) {
			// Never explained and rarely used, or seen only in figures and bare equations
			if (entry.score < 0 || (entry.score < DEFINITION_SCORE && entry.count < 3)) continue;
			let { items, target } = entry;
			let parts = buildExcerpt(items, entry.sentence, entry.symbolAt, target);
			symbols.push({
				symbol: entry.symbol,
				parts,
				meaning: parts.map(part => (typeof part == "string" ? part : part.s)).join(""),
				definition: entry.score >= DEFINITION_SCORE,
				pageIndex: entry.pageIndex,
				start: target.start,
				rect: unionRect(items, target.start, target.end),
				count: entry.count,
			});
		}
		return { bodyFont, symbols };
	}

	return { extract };
})();
