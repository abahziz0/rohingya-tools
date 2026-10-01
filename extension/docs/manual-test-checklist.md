# Manual test checklist

These steps cover what the automated tests can't do: click Chrome's toolbar
button (which grants `activeTab`), answer Chrome's permission prompt, and run
in **branded Google Chrome**. Automated end-to-end tests run in Playwright's
Chromium with a test build that pre-grants `127.0.0.1`.

## Setup

1. At the repository root: `npm ci` and `npm run build`. In `extension/`: `npm run build`
   and `npm run fixtures:serve`.
2. In Chrome, open `chrome://extensions`, turn on Developer mode, click
   **Load unpacked**, and choose `extension/dist`. Pin the extension.
3. Fixtures are at http://127.0.0.1:4173/. `127.0.0.1` is just an ordinary website to the
   release build.

Record the Chrome version and OS you tested on: ____________________

## Toolbar button and activeTab

- [ ] On http://127.0.0.1:4173/mixed-script.html, click the icon. The popup
      says **Ready to convert**.
- [ ] Click **Convert this page**. The letters become Rohingyalish and the
      status says **Rohingyalish is enabled on this page**.
- [ ] Click **Show original**. The Hanifi letters return and the status says
      **Showing the original text**.
- [ ] Open a new tab on another page and click the icon. It is not converted
      (activeTab is per tab).
- [ ] On `chrome://settings`, the Chrome Web Store, and the new-tab page, the
      popup says **This browser page cannot be converted** and all actions
      are disabled.
- [ ] On a page with no Hanifi (for example https://example.com), it says
      **No Hanifi text found**.

## Always convert this website: the real permission prompt

- [ ] On http://127.0.0.1:4173/mixed-script.html, turn on **Always convert
      this website**. Chrome's prompt names **only 127.0.0.1**.
- [ ] Click **Allow**. The page converts and the switch stays on, even if the
      popup closed when the prompt appeared.
- [ ] Reopen the popup. The detail says **127.0.0.1 converts automatically…**
- [ ] Open http://127.0.0.1:4173/rtl-article.html in a new tab. It converts
      without a click.
- [ ] Choose **Show original** on that tab. The switch stays on, and the
      detail explains that future visits still convert.
- [ ] Turn the switch off. `chrome://extensions` → Details → Site access no
      longer lists 127.0.0.1. Reload: the page stays in Hanifi.
- [ ] Turn it on again but click **Deny** in Chrome's prompt. The switch
      returns to off, and the popup says access was not allowed.
- [ ] Turn it on and allow. Then revoke access from the puzzle-piece menu (or
      `chrome://extensions` → Details → Site access). Reopen the popup: it
      says **Website access is required**, the switch is still on, and
      **Allow website access** shows. Click it, allow, and reload: automatic
      conversion is back.
- [ ] Turn it on for `localhost` (serve the fixtures with `localhost` in the
      URL) and check that 127.0.0.1 is unaffected. Each hostname is separate.

## Updates and restarts

- [ ] With "Always convert" on, quit and restart Chrome. Visit the site: it
      converts automatically.
- [ ] Bump `version` in `extension/package.json`, `npm run build`, and click
      the reload icon in `chrome://extensions`. Visit the site: it still
      converts automatically, because registrations are repaired on update.
- [ ] While a converted tab stays open during that reload, the page keeps
      its text. After reloading the tab, the popup works again.

## Page behaviour (visual)

- [ ] **Mixed scripts:** English, Arabic, Bengali and emoji are unchanged.
      The link counter still increments. Hovering the `abbr` shows a Hanifi
      tooltip (attributes are unchanged by design).
- [ ] **Right-to-left article:**
  - [ ] Converted lines read left-to-right, in the correct word order.
  - [ ] The page stays right-aligned.
  - [ ] Arabic words stay in place.
  - [ ] Selecting and copying converted text pastes readable Latin text. It
        may include invisible direction marks.
- [ ] **Dynamic feed:**
  - [ ] Auto-load posts convert as they appear.
  - [ ] "Website edits post 1" converts again.
  - [ ] "Website replaces post 2" keeps the English.
  - [ ] **Show original** leaves post 2 in English and shows post 1's new
        Hanifi.
- [ ] **Editable:** typing in the input, textarea and rich-text box works
      normally, and their Hanifi is never converted.
- [ ] **Large page:** conversion completes quickly and scrolling stays smooth
      during conversion.
- [ ] **Tone marks:** the popup shows **About this conversion** with Hanifi
      examples rendered in the Hanifi font (not boxes).

## Accessibility

- [ ] Popup, keyboard only:
  - [ ] Tab reaches Convert, Show original, the switch, Allow website access
        (when shown), About this conversion, and the converter link.
  - [ ] Focus is always visible.
  - [ ] Space toggles the switch; Enter activates buttons and the link.
- [ ] With a screen reader (VoiceOver: Cmd+F5):
  - [ ] Status changes are announced.
  - [ ] The switch is announced as "Always convert this website, switch".
  - [ ] Disabled buttons are announced as dimmed or unavailable.
- [ ] Dark mode (system appearance). Text and controls keep good contrast.
- [ ] Browser zoom at 200%: the popup content is still usable.

## Real-world pages (owner or fluent reader)

- [ ] Try at least three real websites with Hanifi text, including a
      right-to-left site and a social feed. Note any page where layout breaks
      or text doesn't convert.
- [ ] Have a fluent reader of both scripts compare converted passages with the
      original. Record reviewed examples in
      `converter/transliteration-examples.json`.

## After store publication

- [ ] Install from the store listing. Repeat "Toolbar button" and "Always
      convert" in brief.
