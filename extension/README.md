# Rohingya Reader: Hanifi to Rohingyalish

A Chrome extension (Manifest V3) for people who read Rohingyalish but find
Hanifi Rohingya hard to read. It shows Hanifi text on webpages in Rohingyalish
and can restore the original.

This converts between two writing systems for the same language. It does
**not** translate into another language.

- Conversion happens entirely on the device. There is no backend, account,
  analytics, remote code or network request.
- It uses the shared converter, `../converter/transliterate.ts`,
  bundled at build time. Any improvement to that engine also reaches the
  extension on its next build.
- Verified in Chromium 153 (Playwright). Other browsers have not been tested.
  See [Portability](#portability).

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ojdnhefanlhaamffnpemofgligjbfngg)**
· **[RohingyaLanguage.org](https://rohingyalanguage.org/)**
· **[Online script converter](https://rohingyalanguage.org/tools/script-converter/)**

## Using it

| Popup control | What it does |
| --- | --- |
| **Convert this page** | Converts Hanifi text on the current page, and keeps converting text that loads later (feeds, comments, infinite scroll). |
| **Show original** | Restores the Hanifi text and pauses conversion **for this page only** until you choose Convert again. Your saved website setting doesn't change. |
| **Always convert this website** | Asks Chrome for access to the current website, then converts it automatically on every visit. Turning it off removes that access. |

**"This website"** means the exact hostname of the current page, on http or
https and on any port. `example.com` doesn't include `www.example.com` or
`news.example.com`, so each hostname is a separate choice.

When the converter reports approximations, **About this conversion** lists
them in plain language, with the original Hanifi beside the output.

## Repository layout

```text
extension/
├── src/
│   ├── manifest.json          # source manifest (version comes from package.json)
│   ├── shared/                # hanifi.ts (detection), convert.ts (wraps the shared engine),
│   │                          # sites.ts (what "this website" means), messages.ts, tabs.ts
│   ├── content/               # reader.ts (page conversion + restore), dom.ts (skip rules,
│   │                          # inline adjacency, direction), index.ts (entry, messaging)
│   ├── background/            # site-manager.ts (prefs ↔ permissions ↔ registered scripts), index.ts
│   └── popup/                 # popup.html / .css / .ts, view.ts (status copy, unit-tested)
├── assets/                    # icons (rendered), font licence
├── scripts/                   # build, package, verify, icons, fixtures, server
├── test/unit/                 # vitest (+ jsdom)
├── test/e2e/                  # Playwright: real extension in Chromium
├── test/fixtures/             # demonstration pages (generated test data)
└── docs/                      # privacy information, manual checks, limitations
```

Build output (git-ignored): `dist/` is the unpacked release build,
`dist-test/` is the test build, and `release/` holds the Chrome Web Store ZIP.

## Commands

Run these from `extension/`. You need Node 24.15 or newer. Run `npm ci` from the repository root first.

```bash
npx playwright install chromium # once, for end-to-end tests
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Release build into `dist/`, ready to load unpacked. |
| `npm run watch` | Rebuild `dist/` on change. |
| `npm run typecheck` | TypeScript check of the extension and the shared engine. |
| `npm test` | Unit tests: engine equivalence, DOM conversion/restoration, permission lifecycle, popup copy, linguistic examples. |
| `npm run test:e2e` | Builds `dist-test/`, then loads the **real extension** in Chromium against the local fixtures. |
| `npm run package` | Release build, then `release/rohingya-reader-<version>.zip` with `manifest.json` at its root. |
| `npm run verify` | Checks the ZIP: manifest, referenced files, permissions, no remote code, no dev files or secrets. |
| `npm run check` | typecheck, unit tests, package and verify, in that order. |
| `npm run fixtures` | Regenerates `test/fixtures/` from the shared engine. |
| `npm run fixtures:serve` | Serves the fixtures on http://127.0.0.1:4173, for local browser testing. |
| `npm run icons` | Re-renders the icons and store promo images. |
| `npm run examples:snapshot` | Refreshes the engine-snapshot entries in `../converter/transliteration-examples.json`. |

The browser suite uses local fixtures and does not require another project.

## Load it in Chrome (unpacked)

1. `npm run build`
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/dist` folder.
4. Pin **Rohingya Reader** from the puzzle-piece menu, open any page with
   Hanifi text, click the icon, and choose **Convert this page**.

To try the demonstration pages, run `npm run fixtures:serve` and open
http://127.0.0.1:4173/.

After rebuilding, click the reload icon on the extension's card in
`chrome://extensions`, then reload any open tabs.

## How it works

- **Detection:** only Unicode code points in the Hanifi block
  (U+10D00–U+10D3F) count. Language attributes, fonts and appearance are
  ignored.
- **Conversion:** each maximal run of Hanifi code points goes to
  `hanifiToLatin`. Everything else (English, Arabic, Bengali, emoji,
  punctuation) is copied unchanged. Unit tests check on 3,000 random strings
  that the result equals the engine's output for the whole text.
- **DOM safety:**
  - Only `Text.data` is changed. Elements, attributes and event handlers stay
    as they are, and `innerHTML` is never used.
  - These are skipped: `script`, `style`, form fields, `contenteditable`,
    `role=textbox`, `code`/`pre`/`kbd`/`samp`/`var`, SVG/MathML, media, and
    common code editors (CodeMirror, Monaco, Ace, ProseMirror, Quill).
  - The document `<head>`, including the tab title, is not changed.
- **Restoration:** each changed text node keeps its original text and exactly
  what the extension wrote. **Show original** restores only nodes whose
  current text is still what the extension wrote. Anything the website has
  changed since is left as the website set it. Records are held through
  `WeakRef`/`WeakMap`, so removed nodes are not kept alive.
- **New content:** a `MutationObserver` queues only added or changed nodes.
  Work runs in ~12 ms slices, so a 5,000-paragraph page converts in about
  0.4 s with no long tasks (measured end-to-end). The extension's own writes
  are recognised and ignored, so the observer cannot loop.
- **Words split across elements** (such as a tone sign in its own `<b>`, or
  one letter per `<span>`):
  - adjacent inline text nodes are converted together;
  - the node boundary moves by at most two code points to a point where the
    engine's output provably doesn't change;
  - if no such point exists, the text is left in Hanifi and listed in the
    popup notes.
  - Blocks, `<br>` and form controls are never joined across.
- **Direction:**
  - In a left-to-right context nothing is added.
  - When converted text sits in a right-to-left paragraph, one invisible
    left-to-right isolate (U+2066 … U+2069) is placed inside the existing text
    nodes around the whole converted passage, even across links. Word order
    then reads left-to-right.
  - The page's `dir`, alignment and layout are not changed. `dir="auto"`
    elements resolve their own direction.
- **Always convert:**
  - It uses `optional_host_permissions` plus
    `chrome.scripting.registerContentScripts`.
  - The background worker brings the saved preference, the granted
    permission and the registered script back into agreement on install and
    update, on browser start-up, on `permissions.onAdded`/`onRemoved`, and
    whenever the popup opens.
  - If the user revokes access in Chrome, the preference is kept and the
    popup shows "Website access is required" with an **Allow website access**
    button.
  - Because Chrome's permission prompt can close the popup, the background
    worker finishes enabling the site when access is granted.

### Frames and shadow DOM

In this release only the top-level document is converted. Text inside
iframes (same-origin or cross-origin) and inside shadow DOM (open or closed)
is left unchanged. The end-to-end suite checks this, and it is documented as
a limitation. See [docs/limitations.md](docs/limitations.md).

## Testing

| Layer | What runs | What it proves |
| --- | --- | --- |
| Unit (`npm test`, 55 tests) | vitest, with jsdom for DOM tests | Conversion equals the engine (random property tests); mixed scripts; tone marks; unsupported characters; restoration; website edits after conversion; idempotence; dynamic insertion; observer settling; skipped contexts; split words; RTL isolates; the full permission and registration lifecycle against a fake Chrome API; popup status copy; linguistic example format. |
| End-to-end (`npm run test:e2e`, 17 tests) | Playwright, the **real unpacked extension** in Chromium, the real popup page | Everything above, in a real browser. Also: axe WCAG 2.1 A/AA scans of the popup (light and dark) and keyboard-only operation, visual word order in RTL, `dir="auto"`, links still clickable, no long tasks on a 5,000-paragraph page, iframe/shadow DOM policy, browser pages refused, "Always convert" registering and auto-converting, pause vs saved setting, disabling, repair of a lost registration, **revoking and restoring access through Chrome's own `chrome://extensions` site-access toggle**, survival across a browser restart, against local fixtures. |

Automation can't click Chrome's toolbar button (which grants `activeTab`) or
answer Chrome's permission prompt. So the E2E suite uses `dist-test/`: the
same code, with a manifest that pre-grants `127.0.0.1`. It opens the real popup page in a
tab with `?tabId=`. The steps that need a person are in
[docs/manual-test-checklist.md](docs/manual-test-checklist.md). The
declined-permission path is covered by unit tests only.

## Releasing

1. Bump `version` in `extension/package.json`. Every upload needs a higher
   version.
2. `npm run check` and `npm run test:e2e`.
3. Upload `release/rohingya-reader-<version>.zip`.

See [privacy information](docs/privacy-policy.md).

## Portability

The code uses only standard WebExtension APIs through the `chrome.*`
namespace, and there are no framework dependencies.

- **Chromium browsers** (Edge, Brave, Opera): likely to work from the same
  ZIP, but **not tested**.
- **Firefox:** a future port needs at least
  - `background.scripts` instead of `service_worker`;
  - a `browser_specific_settings.gecko.id`;
  - checks of `scripting.registerContentScripts` persistence and
    optional-permission prompts.

  The DOM and conversion code (`src/content`, `src/shared`) doesn't depend on
  Chrome.

## Fonts and licences

The popup shows Hanifi examples using Noto Sans Hanifi Rohingya from
`assets/fonts/`, under the SIL Open Font License 1.1. The packaged font license
is included as `fonts/OFL.txt`; the code's MIT license is `LICENSE.txt`.
