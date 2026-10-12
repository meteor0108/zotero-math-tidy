# zotero-math-tidy

English | [한국어](README.ko.md)

A Zotero plugin that collects the math symbols of a paper into one glossary next to the PDF, so you don't have to scroll back to find out what a symbol meant.

| Symbol | Meaning |
| --- | --- |
| X<sub>n</sub> | data received from the n-th sensor |
| σ<sup>2</sup> | variance of the observation noise |

## Usage

1. Open a PDF. A **Symbols** section appears in the item pane on the right. (It also shows when you select the item in the library.)
2. Click **Analyze**. The paper is sent to an LLM, which returns each symbol, its meaning, and where it is first defined.
3. The result is saved, so it is there the next time you open the paper. Use the filter box to search symbols or meanings.
4. Click a row to jump to the first place the symbol appears in the PDF. Click again for the next occurrence.
5. After a paper is analyzed, hover over a symbol in the PDF to see its meaning in a tooltip.

Steps 4 and 5 work by matching the glossary against the PDF's character data. Formulas embedded as images, and single-letter symbols written right next to other letters (the `x` in `Wx`), may not be found.

## Settings

Zotero Settings → **Math Tidy**

- **Plugin language**: English or Korean, or the same as Zotero.
- **Language of the meanings**: leave empty to follow the plugin language, or type any language.
- **Provider**: Claude (Anthropic), GPT (OpenAI-compatible) or Gemini (Google). Enter the API key for the one you use.
- **Model**: choose from the dropdown. The list is fetched from the provider once an API key is entered, and refreshed each time the settings page opens or when you click **Refresh list**.
- **Base URL** (GPT): change it to use an OpenAI-compatible server such as OpenRouter or Ollama.
- **Send to the LLM**: *The PDF itself* reads formulas accurately. *Extracted text only* is cheaper, but formulas in extracted text are often garbled. PDFs over 20 MB are always sent as text.

When a provider is overloaded or rate-limited (HTTP 429, 503), the request is retried three times before an error is shown.

API keys are stored unencrypted in your Zotero profile, and the paper is sent to the provider you select. Glossaries are saved as one JSON file per PDF in the `math-tidy/` folder of your Zotero data directory.

## Install

```powershell
.\build.ps1
```

This creates `build/math-tidy.xpi`. In Zotero, go to Tools → Plugins → gear icon → *Install Plugin From File…* and select it. Requires Zotero 7 or later; developed and tested on Zotero 9.

## Development

There is no build step: the `addon/` folder is the plugin.

- `addon/bootstrap.js` — entry point
- `addon/src/math-tidy.js` — preferences, saved glossaries, running an analysis
- `addon/src/llm.js` — Claude, OpenAI-compatible and Gemini requests
- `addon/src/section.js` — the Symbols section in the item pane
- `addon/src/notation.js` — symbol notation (scripts, LaTeX conversion) and rendering
- `addon/src/matcher.js` — finding symbols in a PDF page's characters
- `addon/src/reader.js` — jumping to symbols and hover tooltips in the reader (relies on reader internals)
- `addon/preferences.xhtml`, `addon/preferences.js`, `addon/prefs.js` — settings page and defaults
- `addon/locale/en-US/math-tidy-en.ftl`, `math-tidy-ko.ftl` — English and Korean strings

To load the plugin from source, create a text file named `math-tidy@meteor0108.github.io` in the `extensions/` folder of your Zotero profile, containing the absolute path of the `addon` folder, then restart Zotero.

## License

[MIT](LICENSE)
