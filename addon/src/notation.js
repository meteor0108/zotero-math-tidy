/**
 * Glossary notation: Unicode text with "_x" / "_{...}" subscripts and "^x" / "^{...}"
 * superscripts. LaTeX that models write anyway ("\tau", "\mathbf{x}") is converted.
 */
MathTidy.Notation = (function () {
	const COMMANDS = {
		alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ",
		eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
		xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
		upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
		Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
		Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
		ell: "ℓ", hbar: "ℏ", nabla: "∇", partial: "∂", infty: "∞", prime: "′", star: "*", ast: "*",
		top: "⊤", dagger: "†", sum: "∑", prod: "∏", int: "∫", in: "∈", notin: "∉", forall: "∀",
		exists: "∃", cdot: "·", times: "×", circ: "∘", pm: "±", leq: "≤", le: "≤", geq: "≥", ge: "≥",
		neq: "≠", ne: "≠", approx: "≈", sim: "∼", propto: "∝", to: "→", rightarrow: "→",
		leftarrow: "←", mapsto: "↦", mid: "|", cup: "∪", cap: "∩", subset: "⊂", subseteq: "⊆",
		emptyset: "∅", otimes: "⊗", oplus: "⊕", odot: "⊙", langle: "⟨", rangle: "⟩", lVert: "‖",
		rVert: "‖", Vert: "‖", ldots: "…", dots: "…", cdots: "⋯",
	};
	const ACCENTS = {
		hat: "̂", widehat: "̂", tilde: "̃", widetilde: "̃", bar: "̄",
		overline: "̄", vec: "⃗", dot: "̇", ddot: "̈",
	};
	const ACCENT = /\\(hat|widehat|tilde|widetilde|bar|overline|vec|dot|ddot)\s*(?:\{([^{}]*)\}|(\\[A-Za-z]+|[A-Za-z]))/g;
	const WRAPPER = /\\(?:mathbf|mathrm|mathit|mathsf|mathtt|mathfrak|mathscr|boldsymbol|bm|text|textbf|textit|textrm|operatorname)\s*\{([^{}]*)\}/g;
	// Letters with their own code point outside the contiguous math alphabets
	const DOUBLE_STRUCK = { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" };
	const SCRIPT = { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ" };
	// Notation inside running text: a short Latin/Greek base followed by braced scripts
	const INLINE = /[A-Za-zͰ-Ͽ][A-Za-z0-9Ͱ-Ͽ'′*]{0,11}(?:[_^]\{[^{}]*\})+/g;
	const CHAR_ALIASES = { "'": "′", "’": "′", "∗": "*", "−": "-", "ϵ": "ε", "ϕ": "φ", "ϑ": "θ", "ϱ": "ρ", "ϖ": "π" };

	function styled(text, exceptions, capitalA) {
		return Array.from(text, (ch) => {
			if (exceptions[ch]) return exceptions[ch];
			return /[A-Z]/.test(ch) ? String.fromCodePoint(capitalA + ch.charCodeAt(0) - 65) : ch;
		}).join("");
	}

	// In a symbol, the space after a command only ends its name ("\Delta \tau"); in running text it's a real space
	function replaceCommands(text, isSymbol) {
		return text.replace(/\\([A-Za-z]+)( ?)/g, (match, name, space) => {
			if (isSymbol) return COMMANDS[name] ?? name;
			return name in COMMANDS ? COMMANDS[name] + space : match;
		});
	}

	/**
	 * Convert LaTeX in a symbol to glossary notation
	 */
	function normalize(notation) {
		let result = notation.replace(/\$|\\[()]|\\(?:left|right)(?![A-Za-z])|\\[,;!: ]/g, "");
		let previous;
		do {
			previous = result;
			result = result
				.replace(/\\mathbb\s*\{([^{}]*)\}/g, (match, text) => styled(text, DOUBLE_STRUCK, 0x1D538))
				.replace(/\\mathcal\s*\{([^{}]*)\}/g, (match, text) => styled(text, SCRIPT, 0x1D49C))
				.replace(ACCENT, (match, name, braced, bare) => (braced ?? bare) + ACCENTS[name])
				.replace(WRAPPER, "$1");
		}
		while (result !== previous);
		return replaceCommands(result.replace(/\\\|/g, "‖"), true).trim();
	}

	/**
	 * @return {(String|{ script: Number, children: Array })[]} - Text runs and nested
	 *     subscripts (script -1) / superscripts (script 1)
	 */
	function parse(notation) {
		let nodes = [];
		let text = "";
		let flush = () => {
			if (text) nodes.push(text);
			text = "";
		};
		let i = 0;
		while (i < notation.length) {
			let char = notation[i];
			if ((char != "_" && char != "^") || i + 1 >= notation.length) {
				text += char;
				i++;
				continue;
			}
			let content;
			if (notation[i + 1] == "{") {
				let depth = 1;
				let end = i + 2;
				while (end < notation.length && depth > 0) {
					if (notation[end] == "{") depth++;
					else if (notation[end] == "}") depth--;
					end++;
				}
				content = notation.slice(i + 2, depth == 0 ? end - 1 : end);
				i = end;
			}
			else {
				content = String.fromCodePoint(notation.codePointAt(i + 1));
				i += 1 + content.length;
			}
			flush();
			nodes.push({ script: char == "_" ? -1 : 1, children: parse(content) });
		}
		flush();
		return nodes;
	}

	function renderNodes(doc, parent, nodes) {
		for (let node of nodes) {
			if (typeof node == "string") {
				parent.append(node);
				continue;
			}
			let script = doc.createElementNS(MathTidy.HTML_NS, node.script < 0 ? "sub" : "sup");
			renderNodes(doc, script, node.children);
			parent.append(script);
		}
	}

	/**
	 * Render a symbol into parent with <sub> and <sup> elements
	 */
	function render(doc, parent, notation) {
		renderNodes(doc, parent, parse(normalize(notation)));
	}

	/**
	 * Render running text, typesetting the notation it mentions ("the map M_{a}")
	 */
	function renderText(doc, parent, text) {
		text = replaceCommands(text, false);
		let last = 0;
		for (let match of text.matchAll(INLINE)) {
			parent.append(text.slice(last, match.index));
			let math = doc.createElementNS(MathTidy.HTML_NS, "span");
			math.className = "math-tidy-math";
			renderNodes(doc, math, parse(match[0]));
			parent.append(math);
			last = match.index + match[0].length;
		}
		parent.append(text.slice(last));
	}

	/**
	 * Character as compared between glossary and PDF: math alphabets folded to
	 * plain letters, glyph variants unified, spaces and combining marks dropped
	 */
	function normalizeChar(char) {
		let result = "";
		for (let ch of char.normalize("NFKD")) {
			if (/[\s{}\p{M}]/u.test(ch)) continue;
			result += CHAR_ALIASES[ch] || ch;
		}
		return result;
	}

	function flatten(nodes, script, out) {
		for (let node of nodes) {
			if (typeof node != "string") {
				flatten(node.children, script || node.script, out);
				continue;
			}
			for (let ch of normalizeChar(node)) {
				// Primes are typeset as superscripts
				out.push({ ch, script: script || (ch == "′" ? 1 : 0) });
			}
		}
	}

	/**
	 * The character sequences a symbol can have in a PDF's text: [{ ch, script }, ...].
	 * A subscript next to a superscript may be stored in either order, so both are returned.
	 */
	function variants(notation) {
		let flat = [];
		flatten(parse(normalize(notation)), 0, flat);
		if (!flat.length) return [];

		let runs = [];
		for (let item of flat) {
			let run = runs[runs.length - 1];
			if (run && run[0].script == item.script) run.push(item);
			else runs.push([item]);
		}
		let swap = runs.findIndex((run, i) => i > 0 && run[0].script && runs[i - 1][0].script);
		if (swap < 0) return [flat];
		let swapped = runs.slice();
		[swapped[swap - 1], swapped[swap]] = [swapped[swap], swapped[swap - 1]];
		return [flat, swapped.flat()];
	}

	return { normalize, render, renderText, normalizeChar, variants };
})();
