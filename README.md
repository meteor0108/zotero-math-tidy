# zotero-math-tidy

English | [한국어](README.ko.md)

A Zotero plugin that lists the math symbols of a paper next to the PDF, each with the sentence where the paper defines it, so you don't have to scroll back to find out what a symbol meant.

| Symbol | Where the paper defines it |
| --- | --- |
| **W** | We denote the world frame as **W** and the robot body frame as B. |
| **g** | **g** is the constant gravity vector in W. |
| **ω̂<sub>t</sub>** | where **ω̂<sub>t</sub>** and â<sub>t</sub> are the raw IMU measurements in B at time t. |

Everything is taken from the PDF itself, on your computer. No API key, no account, and nothing is sent anywhere.

![Demo: the Symbols section listing each symbol with its defining sentence, and a tooltip on a symbol in the PDF](docs/demo1.gif)

## Usage

1. Open a PDF. The **Symbols** section in the item pane on the right fills in by itself within a few seconds.
2. Each row shows a symbol and the sentence that defines it, with the page number. Rows in gray are symbols the paper uses often but never defines in a sentence; they show the first sentence that uses them.
3. Click a row to jump to that sentence in the PDF. Click again for the symbol's next occurrence.
4. Hover over a symbol in the PDF to see its definition in a tooltip.
5. Use the filter box to search symbols or sentences. **Analyze again** rebuilds the list.

The result is saved per PDF, so it is there the next time you open the paper. PDFs longer than 80 pages are not analyzed automatically; click **Analyze** for those. From the library, **Analyze** opens the PDF first, because the text is read through the reader.

## How it works

The Zotero reader knows every character of the PDF with its position, font and size. The plugin uses that to:

- **Find symbols**: a letter set in a font other than the body text's (or a Greek letter), together with the accent drawn over it and the smaller characters set below and above it, is read as one symbol such as `ω̂_t` or `M_i^e`.
- **Find definitions**: among the sentences that contain a symbol, it picks the one that reads like a definition: "X is the …", "X denotes …", "where X …", "let X …", "we denote … as X", "the rotation matrix X". Symbols listed together ("where k, u, v, and w are …") share the sentence.

This is done with rules, not a language model, so it has limits:

- The sentences are quoted as written. There is no translation and no summary.
- A sentence that merely mentions a symbol can be mistaken for its definition.
- Symbols defined only inside an equation, or by convention, show a sentence that uses them, or are left out if they appear only once or twice.
- Each index variant is its own entry: `x_i` and `x_{i+1}` are listed separately.
- Letters written right next to each other (the `x` in `Wx`) are not read as symbols.
- Scanned PDFs and formulas stored as images have no characters to read.

## Settings

Zotero Settings → **Math Tidy**

- **Plugin language**: English or Korean, or the same as Zotero.

Glossaries are saved as one JSON file per PDF in the `math-tidy/` folder of your Zotero data directory.

## Install

```powershell
.\build.ps1
```

This creates `build/math-tidy.xpi`. In Zotero, go to Tools → Plugins → gear icon → *Install Plugin From File…* and select it. Requires Zotero 7 or later; developed and tested on Zotero 9.

The plugin reads the reader's internal data, for which Zotero has no plugin API, so a Zotero update can break it.

## Development

There is no build step: the `addon/` folder is the plugin.

- `addon/bootstrap.js` — entry point
- `addon/src/math-tidy.js` — preferences, saved glossaries, running an analysis
- `addon/src/extractor.js` — finding symbols and their defining sentences in the page characters
- `addon/src/matcher.js` — finding a known symbol's occurrences on a page
- `addon/src/notation.js` — symbol notation (scripts, accents) and rendering
- `addon/src/reader.js` — reading page characters, jumping to symbols and hover tooltips in the reader
- `addon/src/section.js` — the Symbols section in the item pane
- `addon/preferences.xhtml`, `addon/preferences.js`, `addon/prefs.js` — settings page and defaults
- `addon/locale/en-US/math-tidy-en.ftl`, `math-tidy-ko.ftl` — English and Korean strings

To load the plugin from source, create a text file named `math-tidy@meteor0108.github.io` in the `extensions/` folder of your Zotero profile, containing the absolute path of the `addon` folder, then restart Zotero.

## License

[MIT](LICENSE)
