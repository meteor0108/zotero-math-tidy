/**
 * LLM-based extraction: sends the paper (the PDF itself, or its extracted text) to
 * Claude, an OpenAI-compatible endpoint or Gemini and gets the glossary back as JSON.
 */
MathTidy.LLM = (function () {
	const REQUEST_TIMEOUT = 10 * 60 * 1000;
	// Overloaded or rate-limited responses are retried after these waits
	const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);
	const RETRY_DELAYS = [3000, 8000, 20000];
	// Larger PDFs are sent as extracted text instead, to stay under the providers' request limits
	const MAX_PDF_BYTES = 20 * 1024 * 1024;
	const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
	// Claude models that accept `fallbacks: "default"`
	const ANTHROPIC_FALLBACK_MODELS = /^claude-(?:fable-5-1|opus-5|sonnet-5-5)/;

	const SCHEMA = {
		type: "object",
		properties: {
			symbols: {
				type: "array",
				items: {
					type: "object",
					properties: {
						symbol: { type: "string" },
						meaning: { type: "string" },
						where: { type: "string" },
					},
					required: ["symbol", "meaning", "where"],
					additionalProperties: false,
				},
			},
		},
		required: ["symbols"],
		additionalProperties: false,
	};

	const USER_PROMPT = "Build the notation glossary for this paper.";

	function systemPrompt(language, inputType) {
		let prompt = `You build a notation glossary for a scientific paper, so that a reader can look up what each mathematical symbol means while reading.

List every distinct symbol that appears in the paper's mathematics: variables, constants, parameters, functions, sets and spaces, and operators the paper defines. For each one give:
- symbol: the symbol as the paper writes it. Use Unicode for Greek letters and math characters (α, ∈, ℝ), _{...} for subscripts and ^{...} for superscripts, and plain text otherwise. No LaTeX commands and no $ delimiters. Examples: X_{n}, σ^{2}, W^{(l)}_{ij}.
- meaning: what it stands for in this paper, as one short phrase that spells out what the indices refer to. For example, for X_{n} in a paper about a sensor array: "data received from the n-th sensor". Write the meanings in ${language}.
- where: where the paper first defines it, such as "Sec. 2.1" or "Eq. (3)". Use an empty string if that is unclear.

An indexed family gets one entry (x_{i}, not x_{1} and x_{2} separately). If the paper uses the same symbol with different meanings in different places, give one entry per meaning and say in the meaning where it applies. Take the meanings from the paper itself: leave out a symbol when the paper neither defines it nor makes its meaning clear from context, and leave out standard notation that needs no explanation, such as = or a plain summation sign. Order the entries by first appearance.`;
		if (inputType == "text") {
			prompt += `

The paper is given as text extracted from a PDF. Extraction often flattens or garbles subscripts, superscripts and special characters in formulas (X_{n} may appear as "Xn" or "X n"), so reconstruct the intended notation from context.`;
		}
		return prompt;
	}

	function toBase64(bytes) {
		let binary = "";
		const CHUNK = 0x8000;
		for (let i = 0; i < bytes.length; i += CHUNK) {
			binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
		}
		return btoa(binary);
	}

	async function buildInput(attachment) {
		if (MathTidy.getPref("input") == "pdf") {
			let path = await attachment.getFilePathAsync();
			if (!path) {
				throw new MathTidy.Error("math-tidy-error-no-file");
			}
			let bytes = await IOUtils.read(path);
			if (bytes.length <= MAX_PDF_BYTES) {
				return { type: "pdf", data: toBase64(bytes), filename: PathUtils.filename(path) };
			}
			MathTidy.log(`PDF is ${bytes.length} bytes -- sending extracted text instead`);
		}
		return { type: "text", text: await MathTidy.getText(attachment) };
	}

	/**
	 * POST JSON and return the parsed JSON response.
	 *
	 * Uses XHR directly rather than Zotero.HTTP, which writes request headers
	 * (including x-api-key) to the debug log.
	 */
	async function post(url, headers, body) {
		for (let delay of [...RETRY_DELAYS, null]) {
			try {
				return await postOnce(url, headers, body);
			}
			catch (e) {
				if (!RETRY_STATUSES.has(e.l10nArgs?.status)) throw e;
				if (delay === null) throw new MathTidy.Error("math-tidy-error-busy", e.l10nArgs);
				MathTidy.log(`API returned ${e.l10nArgs.status} -- retrying in ${delay} ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	function postOnce(url, headers, body) {
		return new Promise((resolve, reject) => {
			let xhr = new XMLHttpRequest();
			xhr.open("POST", url);
			xhr.responseType = "json";
			xhr.timeout = REQUEST_TIMEOUT;
			xhr.setRequestHeader("Content-Type", "application/json");
			for (let [name, value] of Object.entries(headers)) {
				xhr.setRequestHeader(name, value);
			}
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
					resolve(xhr.response);
					return;
				}
				let error = xhr.response?.error;
				let message = (typeof error == "string" ? error : error?.message) || xhr.statusText || "";
				reject(new MathTidy.Error("math-tidy-error-api", { status: xhr.status, message }));
			};
			xhr.onerror = () => reject(new MathTidy.Error("math-tidy-error-network"));
			xhr.ontimeout = () => reject(new MathTidy.Error("math-tidy-error-timeout"));
			xhr.send(JSON.stringify(body));
		});
	}

	function parseSymbols(text) {
		let parsed;
		try {
			// OpenAI-compatible servers without structured output support may fence the JSON
			parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
		}
		catch (e) {
			throw new MathTidy.Error("math-tidy-error-bad-response");
		}
		if (!Array.isArray(parsed?.symbols)) {
			throw new MathTidy.Error("math-tidy-error-bad-response");
		}
		return parsed.symbols
			.filter(entry => typeof entry?.symbol == "string" && entry.symbol.trim())
			.map(entry => ({
				symbol: MathTidy.Notation.normalize(entry.symbol),
				meaning: String(entry.meaning ?? "").trim(),
				where: String(entry.where ?? "").trim(),
			}));
	}

	function requireKey(provider) {
		let key = MathTidy.getPref(provider + ".apiKey").trim();
		if (!key) {
			throw new MathTidy.Error("math-tidy-error-no-key");
		}
		return key;
	}

	const providers = {
		async anthropic(input, system, model) {
			let headers = {
				"x-api-key": requireKey("anthropic"),
				"anthropic-version": "2023-06-01",
			};
			let paper = input.type == "pdf"
				? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.data } }
				: { type: "text", text: input.text };
			let body = {
				model,
				max_tokens: 16000,
				system,
				messages: [{ role: "user", content: [paper, { type: "text", text: USER_PROMPT }] }],
				output_config: { format: { type: "json_schema", schema: SCHEMA } },
			};
			// If a safety classifier declines the request, let the API retry it on its recommended fallback model
			if (ANTHROPIC_FALLBACK_MODELS.test(model)) {
				headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
				body.fallbacks = "default";
			}
			let response = await post("https://api.anthropic.com/v1/messages", headers, body);
			if (response.stop_reason == "refusal") {
				throw new MathTidy.Error("math-tidy-error-refusal");
			}
			if (response.stop_reason == "max_tokens") {
				throw new MathTidy.Error("math-tidy-error-truncated");
			}
			let text = (response.content || [])
				.filter(block => block.type == "text")
				.map(block => block.text)
				.join("");
			return { model: response.model || model, text };
		},

		async openai(input, system, model) {
			let baseURL = (MathTidy.getPref("openai.baseURL").trim() || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
			// Local OpenAI-compatible servers (Ollama, LM Studio) don't need a key
			let key = baseURL == OPENAI_DEFAULT_BASE_URL
				? requireKey("openai")
				: MathTidy.getPref("openai.apiKey").trim();
			let paper = input.type == "pdf"
				? { type: "file", file: { filename: input.filename, file_data: "data:application/pdf;base64," + input.data } }
				: { type: "text", text: input.text };
			let body = {
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: [paper, { type: "text", text: USER_PROMPT }] },
				],
				response_format: {
					type: "json_schema",
					json_schema: { name: "notation_glossary", strict: true, schema: SCHEMA },
				},
			};
			let response = await post(
				baseURL + "/chat/completions",
				key ? { Authorization: "Bearer " + key } : {},
				body
			);
			let choice = response.choices?.[0];
			if (choice?.message?.refusal) {
				throw new MathTidy.Error("math-tidy-error-refusal");
			}
			if (choice?.finish_reason == "length") {
				throw new MathTidy.Error("math-tidy-error-truncated");
			}
			return { model: response.model || model, text: choice?.message?.content || "" };
		},

		async gemini(input, system, model) {
			let paper = input.type == "pdf"
				? { inlineData: { mimeType: "application/pdf", data: input.data } }
				: { text: input.text };
			let body = {
				systemInstruction: { parts: [{ text: system }] },
				contents: [{ role: "user", parts: [paper, { text: USER_PROMPT }] }],
				generationConfig: {
					responseMimeType: "application/json",
					// Gemini's schema dialect has no additionalProperties
					responseSchema: JSON.parse(JSON.stringify(
						SCHEMA,
						(key, value) => (key == "additionalProperties" ? undefined : value)
					)),
				},
			};
			let response = await post(
				`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
				{ "x-goog-api-key": requireKey("gemini") },
				body
			);
			let candidate = response.candidates?.[0];
			if (!candidate || candidate.finishReason == "SAFETY") {
				throw new MathTidy.Error("math-tidy-error-refusal");
			}
			if (candidate.finishReason == "MAX_TOKENS") {
				throw new MathTidy.Error("math-tidy-error-truncated");
			}
			let text = (candidate.content?.parts || [])
				.filter(part => !part.thought)
				.map(part => part.text || "")
				.join("");
			return { model: response.modelVersion || model, text };
		},
	};

	/**
	 * @param {Zotero.Item} attachment - PDF attachment
	 * @param {String} provider - "anthropic", "openai" or "gemini"
	 * @return {Promise<{ symbols: Object[], model: String, input: String }>}
	 */
	async function extract(attachment, provider) {
		let request = providers[provider];
		if (!request) {
			throw new Error(`Unknown provider '${provider}'`);
		}
		// Check the key before reading the PDF
		if (provider != "openai") requireKey(provider);
		let input = await buildInput(attachment);
		let name = MathTidy.getPref(provider + ".model").trim();
		if (!name) {
			throw new MathTidy.Error("math-tidy-error-no-model");
		}
		let { model, text } = await request(input, systemPrompt(MathTidy.getLanguage(), input.type), name);
		return { symbols: parseSymbols(text), model, input: input.type };
	}

	return { extract };
})();
