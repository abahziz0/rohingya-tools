// @vitest-environment node
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { hanifiToLatin, latinToHanifi } from '../../../converter/transliterate';
import { isRightToLeftByAttribute } from '../../src/content/dom';
import { PageReader } from '../../src/content/reader';

// Test words are generated with the shared engine from Rohingyalish spellings
// in the site dictionary. They exercise technical behaviour only and are not
// linguistically reviewed Hanifi.
const hanifi = (latin: string) => latinToHanifi(latin).output;
const latin = (h: string) => hanifiToLatin(h).output;
const W1 = hanifi('kitab');
const W2 = hanifi('fúl');
const W3 = hanifi('ekkán');
const H = (...cps: number[]) => String.fromCodePoint(...cps);
const LRI = '⁦';
const PDI = '⁩';

let dom: JSDOM | null = null;
let reader: PageReader | null = null;

function setup(body: string) {
  dom = new JSDOM(`<!doctype html><html><head><title>${W1}</title></head><body>${body}</body></html>`);
  const doc = dom.window.document;
  reader = new PageReader(doc, { isRtl: isRightToLeftByAttribute, mutationDelayMs: 0, sliceMs: 50 });
  return { doc, reader, window: dom.window };
}

afterEach(() => {
  reader?.stop();
  dom?.window.close();
  dom = null;
  reader = null;
});

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 5; i++) await tick(5);
}
const strip = (s: string | null | undefined) => (s ?? '').replace(/[⁦⁩]/g, '');

describe('page conversion', () => {
  it('converts Hanifi text in place and preserves other scripts', () => {
    const mixed = `English ${W1}, العربية বাংলা 😀 (${W2}).`;
    const { doc, reader } = setup(`<p id="p">${mixed}</p>`);
    const p = doc.getElementById('p')!;
    const textNode = p.firstChild;
    reader.start();
    expect(p.textContent).toBe(latin(mixed));
    expect(p.textContent).toContain('English ');
    expect(p.textContent).toContain('العربية বাংলা 😀');
    expect(p.firstChild).toBe(textNode); // same Text node, edited in place
    expect(reader.status()).toMatchObject({ state: 'active', convertedCount: 1, hanifiFound: true });
  });

  it('matches the shared engine exactly for a whole paragraph', () => {
    const text = `${W1} ${W2} ${W3} ${H(0x10d31, 0x10d32)}`;
    const { doc, reader } = setup(`<p>${text}</p>`);
    reader.start();
    expect(doc.querySelector('p')!.textContent).toBe(hanifiToLatin(text).output);
  });

  it('keeps links, nested markup and event handlers working', () => {
    const { doc, reader, window } = setup(`<p>${W1} <a id="a" href="/x?q=${encodeURIComponent(W2)}" title="${W2}"><em>${W2}</em> more</a> ${W3}</p>`);
    const a = doc.getElementById('a')!;
    const em = a.querySelector('em')!;
    let clicks = 0;
    a.addEventListener('click', e => {
      e.preventDefault();
      clicks++;
    });
    const before = a.outerHTML.replace(/>[^<]*</g, '><');
    reader.start();
    expect(doc.getElementById('a')).toBe(a);
    expect(a.querySelector('em')).toBe(em);
    expect(em.textContent).toBe(latin(W2));
    expect(a.getAttribute('href')).toBe(`/x?q=${encodeURIComponent(W2)}`); // attributes untouched
    expect(a.getAttribute('title')).toBe(W2);
    expect(a.outerHTML.replace(/>[^<]*</g, '><')).toBe(before); // same element structure
    a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
  });

  it('does not touch editable fields, code, scripts or the document head', () => {
    const { doc, reader } = setup(`
      <input id="in" value="${W1}">
      <textarea id="ta">${W1}</textarea>
      <div id="ce" contenteditable="true"><p>${W1}</p></div>
      <div id="ce2" contenteditable="plaintext-only">${W1}</div>
      <div id="tb" role="textbox">${W1}</div>
      <pre id="pre">${W1}</pre>
      <p><code id="code">${W1}</code></p>
      <script id="s">var x = "${W1}";</script>
      <style id="st">.x::after { content: "${W1}"; }</style>
      <select id="sel"><option>${W1}</option></select>
      <div class="cm-editor"><span id="cm">${W1}</span></div>
      <p id="ok">${W1}</p>`);
    reader.start();
    expect((doc.getElementById('in') as HTMLInputElement).value).toBe(W1);
    expect((doc.getElementById('ta') as HTMLTextAreaElement).value).toBe(W1);
    for (const id of ['ce', 'ce2', 'tb', 'pre', 'code', 's', 'sel', 'cm']) expect(doc.getElementById(id)!.textContent).toContain(W1);
    expect(doc.getElementById('st')!.textContent).toContain(W1);
    expect(doc.title).toBe(W1);
    expect(doc.getElementById('ok')!.textContent).toBe(latin(W1));
  });

  it('is idempotent when activated repeatedly', () => {
    const { doc, reader } = setup(`<p>${W1} ${W2}</p>`);
    reader.start();
    const once = doc.body.innerHTML;
    reader.start();
    reader.start();
    expect(doc.body.innerHTML).toBe(once);
    reader.stop();
    reader.start();
    expect(doc.body.innerHTML).toBe(once);
  });

  it('keeps unsupported Hanifi-block characters visible and reports them', () => {
    const odd = `${W1}${H(0x10d28)}`;
    const { doc, reader } = setup(`<p>${odd}</p>`);
    reader.start();
    expect(doc.querySelector('p')!.textContent).toContain(H(0x10d28));
    const notes = reader.status().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'engine', count: 1 });
    expect(notes[0].examples[0].original).toBe(odd);
  });

  it('collects engine approximation notes (tana tone sign)', () => {
    const tana = H(0x10d11, 0x10d1d, 0x10d26);
    const { reader } = setup(`<p>${tana}</p><p>${tana}</p>`);
    reader.start();
    const [note] = reader.status().notes;
    expect(note.detail).toBe(hanifiToLatin(tana).warnings[0]);
    expect(note.count).toBe(2);
    expect(note.examples).toEqual([{ original: tana, converted: latin(tana) }]);
  });
});

describe('restoring the original', () => {
  it('restores exact original text and stops converting', async () => {
    const html = `<p>${W1} <b>${W2}</b> x</p><ul><li>${W3}</li></ul>`;
    const { doc, reader } = setup(html);
    const original = doc.body.innerHTML;
    reader.start();
    expect(doc.body.innerHTML).not.toBe(original);
    const result = reader.stop();
    expect(result.restored).toBe(3);
    expect(doc.body.innerHTML).toBe(original);
    // Paused: new Hanifi text is not converted.
    const p = doc.createElement('p');
    p.textContent = W1;
    doc.body.append(p);
    await settle();
    expect(p.textContent).toBe(W1);
    expect(reader.status().state).toBe('paused');
  });

  it('does not overwrite text the website changed after conversion', async () => {
    const { doc, reader } = setup(`<p id="a">${W1}</p><p id="b">${W2}</p><p id="c">${W3}</p>`);
    reader.start();
    const a = doc.getElementById('a')!;
    const b = doc.getElementById('b')!;
    a.firstChild!.nodeValue = 'Updated by the website'; // site edits a converted node
    b.textContent = 'Replaced by the website'; // site replaces the node
    await settle();
    const result = reader.stop();
    expect(a.textContent).toBe('Updated by the website');
    expect(b.textContent).toBe('Replaced by the website');
    expect(doc.getElementById('c')!.textContent).toBe(W3);
    expect(result.keptWebsiteChanges).toBe(1);
  });

  it('restores the latest website text when the website re-rendered Hanifi', async () => {
    const { doc, reader } = setup(`<p id="a">${W1}</p>`);
    reader.start();
    const node = doc.getElementById('a')!.firstChild as Text;
    node.data = W2; // e.g. a framework re-render with new Hanifi text
    await settle();
    expect(node.data).toBe(latin(W2));
    reader.stop();
    expect(node.data).toBe(W2);
  });
});

describe('dynamic content', () => {
  it('converts inserted nodes and text changes without full rescans', async () => {
    const { doc, reader } = setup(`<main id="feed"><article>${W1}</article></main>`);
    reader.start();
    const feed = doc.getElementById('feed')!;
    for (let i = 0; i < 20; i++) {
      const item = doc.createElement('article');
      item.innerHTML = `<h2>${W2} ${i}</h2><p>Mixed ${W3}</p>`;
      feed.append(item);
    }
    const t = doc.createTextNode(` ${W3}`);
    feed.firstElementChild!.append(t);
    await settle();
    expect(feed.textContent).not.toMatch(/[\u{10D00}-\u{10D3F}]/u);
    expect(feed.querySelectorAll('article')[5].querySelector('p')!.textContent).toBe(`Mixed ${latin(W3)}`);
    expect(t.data).toBe(` ${latin(W3)}`);
  });

  it('settles without an observer loop', async () => {
    const { doc, reader, window } = setup(`<p dir="rtl">${W1} <a href="#">${W2}</a>.</p><p>${W3}</p>`);
    reader.start();
    await settle();
    let mutations = 0;
    const spy = new window.MutationObserver(list => (mutations += list.length));
    spy.observe(doc.body, { subtree: true, characterData: true, childList: true });
    await settle();
    await tick(50);
    expect(mutations).toBe(0);
    spy.disconnect();
  });

  it('processes a large page in slices without blocking for long', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => `<p>${W1} ${i} ${W2}</p>`).join('');
    const { doc, reader } = setup(rows);
    const t0 = performance.now();
    reader.start();
    const firstSlice = performance.now() - t0;
    expect(firstSlice).toBeLessThan(250); // first slice is time-boxed (jsdom is slow)
    for (let i = 0; i < 400 && doc.body.textContent!.match(/[\u{10D00}-\u{10D3F}]/u); i++) await tick(1);
    expect(doc.body.textContent).not.toMatch(/[\u{10D00}-\u{10D3F}]/u);
    expect(reader.status().convertedCount).toBe(4000);
  });

  it('stops quietly when the extension context goes away', async () => {
    let valid = true;
    dom = new JSDOM(`<!doctype html><body><p>${W1}</p></body>`);
    const doc = dom.window.document;
    reader = new PageReader(doc, { isRtl: isRightToLeftByAttribute, mutationDelayMs: 0, isContextValid: () => valid });
    reader.start();
    valid = false;
    const p = doc.createElement('p');
    p.textContent = W2;
    doc.body.append(p);
    await settle();
    expect(p.textContent).toBe(W2);
  });
});

describe('text split across inline elements', () => {
  it('converts a tone sign kept in a separate element together with its vowel', () => {
    const base = H(0x10d11, 0x10d1d);
    const tone = H(0x10d24);
    const { doc, reader } = setup(`<p id="p">${base}<b>${tone}</b> x</p>`);
    const html = doc.body.innerHTML;
    reader.start();
    expect(doc.getElementById('p')!.textContent).toBe(`${latin(base + tone)} x`);
    expect(doc.querySelector('b')).not.toBeNull(); // element kept, now empty
    reader.stop();
    expect(doc.body.innerHTML).toBe(html);
  });

  it('keeps a word split by a link intact', () => {
    const [a, b] = [H(0x10d00), H(0x10d1e, 0x10d15)]; // carrier + vowel across elements
    const { doc, reader } = setup(`<p>${a}<a href="#">${b}</a></p>`);
    reader.start();
    expect(doc.querySelector('p')!.textContent).toBe(latin(a + b));
  });

  it('does not join text across block boundaries or line breaks', () => {
    const { doc, reader } = setup(`<div><p>${H(0x10d11, 0x10d1d)}</p><p>${H(0x10d24)}</p></div><p>${H(0x10d00)}<br>${H(0x10d1e)}</p>`);
    reader.start();
    const ps = doc.querySelectorAll('p');
    expect(ps[0].textContent).toBe(latin(H(0x10d11, 0x10d1d)));
    expect(ps[1].textContent).toBe(latin(H(0x10d24))); // stray tone handled alone
    expect(ps[2].textContent).toBe(latin(H(0x10d00)) + latin(H(0x10d1e)));
  });
});

describe('text direction', () => {
  it('wraps a converted passage in one left-to-right isolate inside an RTL paragraph', () => {
    const { doc, reader } = setup(`<p id="p" dir="rtl">${W1} <a href="#">${W2}</a> ${W3}.</p>`);
    const p = doc.getElementById('p')!;
    reader.start();
    const text = p.textContent!;
    expect(text.startsWith(LRI)).toBe(true);
    expect(text.endsWith(`.${PDI}`)).toBe(true); // trailing punctuation inside the isolate
    expect(text.split(LRI)).toHaveLength(2); // exactly one isolate across the link
    expect(strip(text)).toBe(latin(`${W1} ${W2} ${W3}.`));
    expect(p.getAttribute('dir')).toBe('rtl'); // attribute not changed
    reader.stop();
    expect(p.textContent).toBe(`${W1} ${W2} ${W3}.`);
  });

  it('adds no direction marks in left-to-right text', () => {
    const { doc, reader } = setup(`<p id="p">The word ${W1} means book.</p>`);
    reader.start();
    expect(doc.getElementById('p')!.textContent).toBe(`The word ${latin(W1)} means book.`);
  });

  it('keeps Arabic text outside the isolate in a mixed RTL paragraph', () => {
    const { doc, reader } = setup(`<p id="p" dir="rtl">مرحبا ${W1} ${W2} عالم</p>`);
    reader.start();
    const text = doc.getElementById('p')!.textContent!;
    expect(text).toBe(`مرحبا ${LRI}${latin(W1)} ${latin(W2)}${PDI} عالم`);
  });

  it('extends the isolate when new converted text arrives in the same paragraph', async () => {
    const { doc, reader } = setup(`<p id="p" dir="rtl">${W1}</p>`);
    reader.start();
    const p = doc.getElementById('p')!;
    const span = doc.createElement('span');
    span.textContent = ` ${W2}`;
    p.append(span);
    await settle();
    expect(p.textContent).toBe(`${LRI}${latin(W1)} ${latin(W2)}${PDI}`);
    reader.stop();
    expect(p.textContent).toBe(`${W1} ${W2}`);
  });
});
