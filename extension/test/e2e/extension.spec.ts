/**
 * End-to-end tests: the real unpacked extension (test build) in Chromium,
 * driving the real popup page against local fixture pages.
 *
 * Not covered here (see docs/manual-test-checklist.md): clicking the
 * toolbar button (activeTab grant) and answering Chrome's permission prompt.
 */
import { expect, test, type Page } from '@playwright/test';
import { hanifiToLatin } from '../../../converter/transliterate';
import { FIXTURES, HANIFI, launch, openPopup, statusTitle, tabIdOf, visibleText, type Harness } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  await h.context.close();
});

const engine = (s: string) => hanifiToLatin(s).output;

async function open(path: string): Promise<Page> {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  return page;
}

async function convert(page: Page): Promise<Page> {
  const popup = await openPopup(h, page);
  await popup.click('#convert');
  await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page');
  return popup;
}

test('converts mixed-script text, matches the engine, keeps links and attributes', async () => {
  const page = await open('mixed-script.html');
  const before = await page.locator('main').evaluate(el => ({ text: el.textContent!, html: el.innerHTML }));
  const popup = await openPopup(h, page);
  await expect(statusTitle(popup)).toHaveText('Ready to convert');
  await expect(popup.locator('#status-detail')).toHaveText('This page contains Hanifi text.');
  await popup.click('#convert');
  await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page');

  expect(await visibleText(page, 'main')).toBe(engine(before.text));
  await expect(page.locator('#mixed')).toContainText('Arabic: كتاب. Bengali: বই. Emoji: 📚✨.');
  // Links and handlers still work.
  await page.click('#lang-link');
  await page.click('#lang-link');
  await expect(page.locator('#clicks')).toHaveText('2');
  // Attributes are unchanged in this release.
  const abbrTitle = await page.locator('abbr').getAttribute('title');
  expect(abbrTitle).toMatch(HANIFI);
  expect(await page.locator('img').getAttribute('alt')).toMatch(HANIFI);
  // Structure is unchanged (only text differs).
  const shape = (html: string) => html.replace(/>[^<]*</g, '><').replace(/"[^"]*"/g, '""');
  expect(shape(await page.locator('main').innerHTML())).toBe(shape(before.html));

  // Show original restores everything exactly.
  await popup.click('#original');
  await expect(statusTitle(popup)).toHaveText('Showing the original text');
  expect((await page.locator('main').innerHTML()).replace('<output id="clicks">2</output>', '<output id="clicks">0</output>')).toBe(before.html);
});

test('repeated activation and repeated injection never double-convert', async () => {
  const page = await open('mixed-script.html');
  const original = await page.locator('main').textContent();
  const tabId = await tabIdOf(h, page);
  for (let i = 0; i < 3; i++) {
    await h.worker.evaluate(async id => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    }, tabId);
  }
  const popup = await convert(page);
  const once = await page.locator('main').textContent();
  await popup.click('#original');
  await popup.click('#convert');
  await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page');
  expect(await page.locator('main').textContent()).toBe(once);
  expect((await visibleText(page, 'main'))).toBe(engine(original!));
});

test('right-to-left pages: converted text reads left-to-right without changing dir', async () => {
  const page = await open('rtl-article.html');
  const p1Before = await page.locator('#p1').textContent();
  await convert(page);
  expect(await visibleText(page, '#p1')).toBe(engine(p1Before!));
  expect(await page.getAttribute('html', 'dir')).toBe('rtl');
  expect(await page.getAttribute('#p1', 'dir')).toBeNull();

  // Visual word order: each word is drawn to the right of the previous one.
  const lefts = await page.locator('#p1').evaluate(p => {
    const text = (p.textContent ?? '').replace(/[⁦⁩]/g, '');
    const words = text.split(/[\s،۔]+/).filter(w => /[a-zñçáéíóú]/i.test(w)).slice(0, 5);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const positions: number[] = [];
    let wi = 0;
    for (let n = walker.nextNode(); n && wi < words.length; n = walker.nextNode()) {
      const data = (n as Text).data;
      let from = 0;
      while (wi < words.length) {
        const at = data.indexOf(words[wi], from);
        if (at < 0) break;
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + words[wi].length);
        positions.push(r.getBoundingClientRect().left);
        from = at + words[wi].length;
        wi++;
      }
    }
    return positions;
  });
  expect(lefts.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThan(lefts[i - 1]);

  // dir="auto" resolves itself once the text is Latin.
  expect(await page.locator('#auto').evaluate(el => getComputedStyle(el).direction)).toBe('ltr');
  // Arabic in a mixed paragraph is untouched.
  await expect(page.locator('#p4')).toContainText('مرحبا');
  await expect(page.locator('#p4')).toContainText('عالم');
});

test('dynamic feed: new posts, website edits and replacements', async () => {
  const page = await open('dynamic-feed.html');
  const popup = await convert(page);
  await page.click('#add');
  await page.click('#bulk');
  await expect.poll(async () => HANIFI.test((await page.locator('#feed').textContent())!)).toBe(false);
  expect(await page.locator('.post').count()).toBe(504);

  // Website edits post 1 (new Hanifi) and replaces post 2 (English).
  await page.click('#edit');
  await page.click('#replace');
  const post1 = page.locator('.post p').first();
  await expect.poll(async () => HANIFI.test((await post1.textContent())!)).toBe(false);
  const edited = await page.evaluate(() => (window as unknown as { WORDS: string[] }).WORDS ?? null);
  expect(edited).toBeNull(); // page variables are not visible to the extension and vice versa

  await popup.click('#original');
  await expect(statusTitle(popup)).toHaveText('Showing the original text');
  // Post 1 shows the website's latest Hanifi text; post 2 keeps the website's English.
  await expect(post1).toContainText(/[\u{10D00}-\u{10D3F}]/u);
  await expect(page.locator('.post p').nth(1)).toContainText('Replaced by the website');
  // Paused: new posts stay in Hanifi.
  await page.click('#add');
  await expect(page.locator('.post').last()).toContainText(/[\u{10D00}-\u{10D3F}]/u);
});

test('editable fields, code and scripts are untouched', async () => {
  const page = await open('editable.html');
  const snapshot = () =>
    page.evaluate(() => ({
      input: (document.getElementById('input') as HTMLInputElement).value,
      textarea: (document.getElementById('textarea') as HTMLTextAreaElement).value,
      editable: document.getElementById('editable')!.innerHTML,
      textbox: document.getElementById('textbox')!.textContent,
      pre: document.getElementById('pre')!.textContent,
      code: document.getElementById('code')!.textContent,
      kbd: document.getElementById('kbd')!.textContent,
      select: document.getElementById('select')!.innerHTML,
      data: document.getElementById('data')!.textContent,
      styled: getComputedStyle(document.getElementById('styled')!, '::after').content,
    }));
  const before = await snapshot();
  await convert(page);
  expect(await page.locator('#plain').textContent()).not.toMatch(HANIFI);
  expect(await snapshot()).toEqual(before);
  // Typing Hanifi into the editor after conversion is left alone.
  await page.locator('#editable').click();
  await page.keyboard.type(String.fromCodePoint(0x10d11, 0x10d1d));
  await page.waitForTimeout(300);
  expect(await page.locator('#editable').textContent()).toContain(String.fromCodePoint(0x10d11, 0x10d1d));
});

test('words split across inline elements match the engine output for the joined text', async () => {
  const page = await open('split-words.html');
  await convert(page);
  for (const id of ['s1', 's2', 's3', 's4', 's5']) {
    const row = page.locator(`tr:has(#${id})`);
    const expected = await row.locator('code').textContent();
    expect(await visibleText(page, `#${id}`), id).toBe(expected);
  }
  // Separate blocks are converted separately.
  await expect(page.locator('#s6 div').first()).toHaveText(engine(String.fromCodePoint(0x10d11, 0x10d1d)));
});

test('tone marks and unsupported characters match the engine; notes are shown', async () => {
  const page = await open('tone-marks.html');
  const popup = await convert(page);
  for (let i = 1; i <= 11; i++) {
    const cell = page.locator(`#t${i}`);
    const expected = (await page.locator(`tr:has(#t${i}) code`).textContent())!;
    const actual = await visibleText(page, `#t${i}`);
    if (i === 8) expect(actual).toBe(`x ${expected}`);
    else expect(actual, `row t${i}`).toBe(expected);
    await expect(cell).toBeVisible();
  }
  // U+10D28 is kept (not silently discarded).
  expect(await page.locator('#t9').textContent()).toContain(String.fromCodePoint(0x10d28));
  const notes = popup.locator('#notes');
  await expect(notes).toBeVisible();
  await expect(popup.locator('#notes-summary')).toHaveText(/About this conversion \(\d+ notes?\)/);
  await popup.locator('#notes-summary').click();
  await expect(popup.locator('#notes-list li')).toHaveCount(3); // tana, stray sign, unassigned code point
  await expect(popup.locator('#notes-list .hanifi').first()).toBeVisible();
});

test('large page converts in slices without long main-thread blocks', async () => {
  const page = await open('large-page.html');
  await expect(page.locator('#generated')).toHaveText('5000');
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver(list => list.getEntries().forEach(e => w.__long.push(e.duration))).observe({ type: 'longtask' });
  });
  const t0 = Date.now();
  await convert(page);
  await expect.poll(async () => HANIFI.test((await page.locator('#rows').textContent())!), { timeout: 30_000 }).toBe(false);
  const elapsed = Date.now() - t0;
  const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const worst = Math.max(0, ...longTasks);
  console.log(`large page: converted 5000 paragraphs in ~${elapsed} ms; long tasks: ${longTasks.length}, worst ${Math.round(worst)} ms`);
  expect(worst).toBeLessThan(250);
});

test('iframes and shadow DOM are not converted (documented policy)', async () => {
  const page = await open('frames-shadow.html');
  await convert(page);
  expect(await page.locator('#top').textContent()).not.toMatch(HANIFI);
  expect(await page.frameLocator('#frame').locator('#inner').textContent()).toMatch(HANIFI);
  expect(await page.locator('#shadow-host').evaluate(el => el.shadowRoot!.textContent)).toMatch(HANIFI);
});

test('browser pages cannot be converted', async () => {
  const page = await h.context.newPage();
  await page.goto('chrome://version');
  const tabId = await h.worker.evaluate(async () => (await chrome.tabs.query({ url: 'chrome://version/' }))[0]?.id);
  const popup = await h.context.newPage();
  await popup.goto(`chrome-extension://${h.extensionId}/popup/popup.html?tabId=${tabId}`);
  await expect(statusTitle(popup)).toHaveText('This browser page cannot be converted');
  await expect(popup.locator('#convert')).toBeDisabled();
  await expect(popup.locator('#site')).toBeHidden();
});

test('no Hanifi text found', async () => {
  // The fixture index page has no Hanifi text.
  const page = await open('index.html');
  const popup = await openPopup(h, page);
  await expect(statusTitle(popup)).toHaveText('No Hanifi text found');
  await expect(popup.locator('#convert')).toBeEnabled();
});

test('always convert this website: register, auto-convert, pause, disable', async () => {
  const page = await open('mixed-script.html');
  const popup = await openPopup(h, page);
  await expect(popup.locator('#site-host')).toHaveText('127.0.0.1');
  await expect(popup.locator('#always')).not.toBeChecked();
  await popup.locator('#always').check();
  await expect(popup.locator('#site-detail')).toHaveText('127.0.0.1 converts automatically when you visit. Other websites are not affected.');
  await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page'); // current page converted too

  const registered = await h.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  expect(registered).toEqual([
    expect.objectContaining({ id: 'rr-site:127.0.0.1', matches: ['*://127.0.0.1/*'], js: ['content.js'], allFrames: false, persistAcrossSessions: true }),
  ]);

  // A new visit converts automatically.
  const other = await open('rtl-article.html');
  await expect.poll(async () => HANIFI.test((await other.locator('main').textContent())!)).toBe(false);
  const popup2 = await openPopup(h, other);
  await expect(popup2.locator('#status-detail')).toContainText('(automatic for this website)');

  // Show original pauses only this page; the saved choice stays on.
  await popup2.click('#original');
  await expect(statusTitle(popup2)).toHaveText('Showing the original text');
  await expect(popup2.locator('#status-detail')).toContainText('Always convert stays on for future visits to 127.0.0.1.');
  await expect(popup2.locator('#always')).toBeChecked();
  await other.waitForTimeout(300);
  expect(await other.locator('main').textContent()).toMatch(HANIFI);
  await other.reload();
  await expect.poll(async () => HANIFI.test((await other.locator('main').textContent())!)).toBe(false);

  // Turning it off removes the registration; future visits stay in Hanifi.
  await popup2.reload();
  await popup2.locator('#always').uncheck();
  await expect(popup2.locator('#always')).not.toBeChecked();
  await expect.poll(() => h.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  const later = await open('split-words.html');
  await later.waitForTimeout(500);
  expect(await later.locator('main').textContent()).toMatch(HANIFI);
});

test('always convert: a lost script registration is repaired when the popup opens', async () => {
  const page = await open('mixed-script.html');
  const popup = await openPopup(h, page);
  await popup.locator('#always').check();
  await expect(popup.locator('#always')).toBeChecked();
  await expect.poll(() => h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(1);

  // Registration lost (as can happen on extension update) → repaired when the popup opens.
  await h.worker.evaluate(() => chrome.scripting.unregisterContentScripts());
  const popup2 = await openPopup(h, page);
  await expect(popup2.locator('#always')).toBeChecked();
  expect(await h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id))).toEqual(['rr-site:127.0.0.1']);

  // (Revocation is tested through Chrome's own settings UI in the next test:
  // the test build's pre-granted host cannot be removed with permissions.remove.)
});

test('always convert: user revokes and restores website access in Chrome settings', async () => {
  const page = await open('mixed-script.html');
  const popup = await openPopup(h, page);
  await popup.locator('#always').check();
  await expect.poll(() => h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(1);
  await h.worker.evaluate(() => {
    const g = self as unknown as { __events: string[] };
    g.__events = [];
    chrome.permissions.onRemoved.addListener(() => g.__events.push('removed'));
    chrome.permissions.onAdded.addListener(() => g.__events.push('added'));
  });

  // The same control a user would use: chrome://extensions → Details → site access toggle.
  const settings = await h.context.newPage();
  await settings.goto(`chrome://extensions/?id=${h.extensionId}`);
  // "Automatically allow access on the following sites" — turning it off withholds site access.
  const siteToggle = settings.locator('extensions-toggle-row#allHostsToggle cr-toggle');
  await expect(siteToggle).toHaveAttribute('aria-pressed', 'true');
  await siteToggle.click();
  await expect(siteToggle).toHaveAttribute('aria-pressed', 'false');

  await expect.poll(() => h.worker.evaluate(() => (self as unknown as { __events: string[] }).__events)).toContain('removed');
  await expect.poll(() => h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(0);
  // Without access (and without a toolbar click granting activeTab, which automation
  // cannot do) the extension can no longer read this tab's URL. Check the saved state
  // through the popup page's own messaging; the popup copy for it is unit-tested.
  const state = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'rr:site-state', host: '127.0.0.1' }));
  expect(state).toEqual({ host: '127.0.0.1', enabled: true, hasAccess: false }); // choice kept, access missing

  // New visits are no longer converted automatically; the popup explains why.
  const fresh = await open('rtl-article.html');
  await fresh.waitForTimeout(500);
  expect(await fresh.locator('main').textContent()).toMatch(HANIFI);

  // Restoring access in Chrome settings re-registers the script.
  await settings.bringToFront();
  await siteToggle.click();
  await expect(siteToggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => h.worker.evaluate(() => (self as unknown as { __events: string[] }).__events)).toContain('added');
  await expect.poll(() => h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id))).toEqual(['rr-site:127.0.0.1']);
  await fresh.reload();
  await expect.poll(async () => HANIFI.test((await fresh.locator('main').textContent())!)).toBe(false);
});

test('always convert survives a browser restart', async () => {
  const page = await open('mixed-script.html');
  const popup = await openPopup(h, page);
  await popup.locator('#always').check();
  await expect.poll(() => h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(1);
  const dir = h.userDataDir;
  await h.context.close();

  h = await launch(dir);
  const again = await h.context.newPage();
  await again.goto(`${FIXTURES}/tone-marks.html`);
  await expect.poll(async () => HANIFI.test((await again.locator('#t1').textContent())!)).toBe(false);
  const scripts = await h.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
  expect(scripts).toEqual(['rr-site:127.0.0.1']);
});
