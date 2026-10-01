# Limitations and support policy (version 0.1.0)

## Linguistic: the converter is approximate

The extension uses the website's rule-based converter
(`converter/transliterate.ts`) and doesn't change any of its mappings.
**No output has been verified by fluent readers yet.**
`converter/transliteration-examples.json` has no `verified` entries,
only engine snapshots. The tests show that the extension reproduces the
engine exactly. They don't show that the engine's output is the intended
Rohingyalish spelling.

Current engine behaviour that may not match what writers intend:

| Hanifi | Engine output | Note |
| --- | --- | --- |
| Tone sign **tana** (U+10D26) | acute accent, the same as harbahay | The engine reports a warning, and the popup shows it. |
| **Sakin** (U+10D22) | dropped | Has no Latin equivalent. No warning. |
| **Kinna wa / kinna ya** (U+10D17 / U+10D19) | `w` / `y` | The distinction from wa / ya is lost. No warning. |
| Carrier **letter A** (U+10D00) | silent before a vowel; `a` when alone | |
| TA (U+10D03) | always `t` | Rohingyalish `ts` is written with TA, so it reads back as `t`. |
| SHA (U+10D10) | always `ch` | Loose spelling `sh` reads back as `ch`. |
| NGA / NYA | always `ñg` / `ñy` | Dictionary spellings with plain `ng` / `ny` read back with `ñ`. |
| Tone sign with no letter before it | skipped | Warns. |
| Unassigned code points in the block (U+10D28–U+10D2F, U+10D3A–U+10D3F) | kept as they are | Warns. The characters are not discarded. |
| Arabic punctuation used with Hanifi (، ؛ ؟ ۔) | unchanged | Not part of the Hanifi block. |
| Tatweel, ZWJ/ZWNJ | unchanged | |

A successful round trip checks conversion consistency; it does not establish
linguistic accuracy.

## Technical scope

**Converted:** Unicode Hanifi text in the visible text of the top-level
document of ordinary http, https and (with "Allow access to file URLs")
file pages. This includes text that loads later.

**Not converted, by design:**

- HTML attributes: tooltips (`title`), image `alt` text, `placeholder`,
  `aria-label`.
- The document `<head>`, including the tab title.
- CSS-generated content (`::before`/`::after`).
- Form fields (`input`, `textarea`, `select`/`option`), `contenteditable`
  regions, `role="textbox"`/`searchbox`/`combobox`, and common editors
  (CodeMirror, Monaco, Ace, ProseMirror, Quill).
- Code: `code`, `pre`, `kbd`, `samp`, `var`.
- SVG and MathML text, and canvas, video and audio.
- **Iframes** (same-origin and cross-origin) and **shadow DOM** (open and
  closed). This is a deliberate, tested policy for this release.
- Browser pages: `chrome://`, the Chrome Web Store, other extensions' pages,
  `view-source:`, and the PDF viewer.
- Outside the project's scope: text in images (OCR), scanned documents,
  legacy (pre-Unicode) font encodings, PDFs, native apps, and translation.

**Edge cases:**

- **Words split across elements:** adjacent inline text nodes (in `b`, `span`,
  `a` and similar) are converted together when a tone sign or letter sits in
  another element. The converted text may then move by one or two characters
  into the neighbouring element. If no provably safe split exists, the text
  stays in Hanifi and the popup says so. Text is never joined across blocks,
  `<br>`, images or form controls. Custom elements count as blocks.
- **Direction:**
  - In right-to-left paragraphs the converted passage is wrapped in invisible
    Unicode isolate characters (U+2066/U+2069). They may appear in copied
    text.
  - Paragraph alignment stays as the site set it, so right-aligned
    paragraphs remain right-aligned.
  - Direction marks are not added to paragraphs with more than 2,000 text
    nodes.
- **Frameworks:**
  - Pages that re-render text (React, Vue) are handled: new Hanifi text is
    converted again.
  - If a site merges text nodes (`Node.normalize()`) after conversion, that
    text is treated as the site's own and isn't restored.
  - If the site replaces converted text, **Show original** leaves the site's
    version.
- **Extension update while a page is open:** the old copy of the script stops
  converting new text, and the page keeps its current text. Reload the page
  to switch.
- **"Always convert" and hostnames:**
  - It applies to one hostname at a time.
  - IPv6-literal hosts can be converted manually but can't be saved.
  - `www.` and bare domains are separate choices.
- **Revoked access:** if access is revoked in Chrome, the saved choice is
  kept and the popup asks for access again. Automatic conversion stays off
  until access is allowed.
