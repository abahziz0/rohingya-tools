// Generates the local demonstration pages in test/fixtures/.
//
// Hanifi text on these pages is produced from Rohingyalish words in the
// documented Rohingyalish examples using the shared
// converter. It is TEST DATA for checking technical behaviour — detection,
// layout, restoration — not reviewed Rohingya text, and the word sequences
// are not meaningful sentences.
//
//   {{kitab}}              -> Hanifi from Rohingyalish via latinToHanifi
//   {{cp:10D11 10D1D}}     -> exact code points (for tone-mark edge cases)
//   {{out:...}}            -> the engine's Latin output for the Hanifi of ... (for "expected" columns)
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hanifiToLatin, latinToHanifi } from '../../converter/transliterate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test/fixtures');

const cp = spec => String.fromCodePoint(...spec.trim().split(/\s+/).map(h => parseInt(h, 16)));
const toHanifi = s => (s.startsWith('cp:') ? cp(s.slice(3)) : latinToHanifi(s).output);
const fill = html =>
  html.replace(/\{\{(out:)?([^}]+)\}\}/g, (_, isOut, body) => (isOut ? hanifiToLatin(toHanifi(body)).output : toHanifi(body)));

const layout = (title, body, { dir = 'ltr', lang = 'en', script = '' } = {}) => `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Rohingya Reader fixtures</title>
<link rel="stylesheet" href="assets/fixtures.css">
</head>
<body>
<p class="banner" dir="ltr" lang="en"><a href="index.html">All fixtures</a> · <strong>Test data.</strong> Hanifi on this page was generated from Rohingyalish examples with the shared converter. It checks technical behaviour only and is not reviewed Rohingya text.</p>
${fill(body)}
${script ? `<script>\n${fill(script)}\n</script>` : ''}
</body>
</html>
`;

const pages = {
  'mixed-script.html': layout('Mixed scripts, links and markup', `
<main>
  <h1>Mixed-script article</h1>
  <p id="mixed">The Rohingya word {{kitab}} means “book”. Arabic: كتاب. Bengali: বই. Emoji: 📚✨. Number: {{2026}}.</p>
  <p id="with-link">Learn about {{zuban}} on the <a id="lang-link" href="#lang">{{zuban}} page</a> (link clicks: <output id="clicks">0</output>).</p>
  <p id="nested"><strong>{{fúl}}</strong>, <em>{{gas}} <a href="#fish">{{mas}}</a></em> and <mark>{{faní}}</mark>.</p>
  <ul id="list"><li>{{maa}}</li><li>{{fua}}</li><li>English only</li></ul>
  <table id="table"><thead><tr><th>English</th><th>Rohingya</th></tr></thead>
    <tbody><tr><td>house</td><td>{{gór}}</td></tr><tr><td>village</td><td>{{fara}}</td></tr><tr><td>road</td><td>{{rasta}}</td></tr></tbody></table>
  <p id="attrs"><abbr title="{{nam}}">{{nam}}</abbr> <img alt="{{faní}}" title="{{faní}}" width="1" height="1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="> — attributes (title, alt) stay unchanged in this release.</p>
  <p id="button-row"><button id="btn" type="button">{{forá}}</button> <label><input type="checkbox"> {{lek}}</label></p>
</main>`, {
    script: `
document.getElementById('lang-link').addEventListener('click', e => {
  e.preventDefault();
  const o = document.getElementById('clicks');
  o.textContent = String(Number(o.textContent) + 1);
});`,
  }),

  'rtl-article.html': layout('Right-to-left article', `
<main>
  <h1 id="title">{{zuban}} {{kitab}}</h1>
  <p id="p1">{{aijja}} {{zór}} {{din}}، {{manúic}} <a id="rtl-link" href="#x">{{eskul}} {{rasta}}</a> {{fara}}۔</p>
  <p id="p2">{{nam}} ({{kitab}}) {{2025}} {{lek}}؟ {{forá}} {{cánti}}۔</p>
  <p id="p3">{{gas}} <b>{{mas}}</b> <i>{{soil}}</i> — English words inside — {{faní}}.</p>
  <p id="p4">مرحبا {{kitab}} {{fúl}} عالم</p>
  <div id="auto" dir="auto">{{kolób}} {{amón}} {{bála}}</div>
  <blockquote id="quote">«{{zuban}} {{lofzó}}»</blockquote>
</main>`, { dir: 'rtl', lang: 'rhg' }),

  'dynamic-feed.html': layout('Dynamic feed', `
<main>
  <h1>Dynamic feed</h1>
  <p class="controls">
    <button id="add" type="button">Add a post</button>
    <button id="auto" type="button" aria-pressed="false">Auto-load posts</button>
    <button id="edit" type="button">Website edits post 1</button>
    <button id="replace" type="button">Website replaces post 2</button>
    <button id="bulk" type="button">Load 500 posts</button>
  </p>
  <p>Posts: <output id="count">0</output></p>
  <section id="feed" aria-label="Feed"></section>
</main>`, {
    script: `
const WORDS = [${['kitab', 'fúl', 'faní', 'gór', 'eskul', 'zuban', 'manúic', 'rasta', 'gas', 'mas', 'din', 'aijja', 'cánti', 'kolób', 'forá', 'lek'].map(w => JSON.stringify(toHanifi(w))).join(', ')}];
const feed = document.getElementById('feed');
let n = 0;
function post() {
  n++;
  const a = document.createElement('article');
  a.className = 'post';
  const words = Array.from({ length: 6 }, (_, i) => WORDS[(n * 7 + i * 3) % WORDS.length]);
  a.innerHTML = '<h2>Post ' + n + ' · ' + words[0] + '</h2><p>' + words.join(' ') + ' <a href="#p' + n + '">' + words[1] + '</a></p>';
  feed.append(a);
  document.getElementById('count').textContent = String(n);
}
for (let i = 0; i < 3; i++) post();
document.getElementById('add').onclick = post;
let timer = null;
document.getElementById('auto').onclick = e => {
  if (timer) { clearInterval(timer); timer = null; } else { timer = setInterval(post, 1000); }
  e.currentTarget.setAttribute('aria-pressed', String(Boolean(timer)));
};
document.getElementById('edit').onclick = () => {
  // The website updates the text node of post 1 with new Hanifi text.
  const p = feed.querySelector('.post p');
  p.firstChild.nodeValue = WORDS[3] + ' ' + WORDS[4] + ' ' + WORDS[5] + ' ';
};
document.getElementById('replace').onclick = () => {
  // The website replaces post 2 with English content.
  feed.querySelectorAll('.post')[1].querySelector('p').textContent = 'Replaced by the website at ' + new Date().toLocaleTimeString();
};
document.getElementById('bulk').onclick = () => { for (let i = 0; i < 500; i++) post(); };`,
  }),

  'editable.html': layout('Editable fields and code', `
<main>
  <h1>Editable fields and code stay unchanged</h1>
  <p id="plain">Plain text converts: {{kitab}} {{fúl}}</p>
  <p><label>Input <input id="input" value="{{kitab}}"></label></p>
  <p><label>Textarea <textarea id="textarea">{{faní}} {{gór}}</textarea></label></p>
  <div id="editable" contenteditable="true" class="box">Rich-text editor: {{zuban}} <b>{{lek}}</b></div>
  <div id="textbox" role="textbox" aria-label="Custom text box" class="box">{{nam}}</div>
  <pre id="pre">{{cánti}} (preformatted)</pre>
  <p>Inline code: <code id="code">{{kitab}}</code> <kbd id="kbd">{{fúl}}</kbd></p>
  <p><label>Select <select id="select"><option>{{maa}}</option><option>{{fua}}</option></select></label></p>
  <script id="data" type="application/json">{"word": "{{kitab}}"}</script>
  <style>.fixture-style::after { content: "{{faní}}"; }</style>
  <p class="fixture-style" id="styled">Generated content (CSS) stays Hanifi: </p>
</main>`),

  'split-words.html': layout('Words split across elements', `
<main>
  <h1>Words split across inline elements</h1>
  <table>
    <thead><tr><th>Case</th><th>Page text</th><th>Engine output for the joined text</th></tr></thead>
    <tbody>
      <tr><td>Tone sign in its own element</td><td id="s1">{{cp:10D11 10D1D}}<b>{{cp:10D24}}</b></td><td><code>{{out:cp:10D11 10D1D 10D24}}</code></td></tr>
      <tr><td>Carrier letter + vowel split by a link</td><td id="s2">{{cp:10D00}}<a href="#">{{cp:10D1E 10D15}}</a></td><td><code>{{out:cp:10D00 10D1E 10D15}}</code></td></tr>
      <tr><td>Gemination (tassi) split</td><td id="s3">{{cp:10D13}}<span class="hl">{{cp:10D27 10D1D}}</span></td><td><code>{{out:cp:10D13 10D27 10D1D}}</code></td></tr>
      <tr><td>Every letter in its own span</td><td id="s4"><span class="hl">{{cp:10D11}}</span><span>{{cp:10D1E}}</span><span class="hl">{{cp:10D03}}</span><span>{{cp:10D1D}}</span><span class="hl">{{cp:10D01}}</span></td><td><code>{{out:kitab}}</code></td></tr>
      <tr><td>Vowel + long-vowel sign split</td><td id="s5">{{cp:10D0C 10D1D}}<em>{{cp:10D25}}</em></td><td><code>{{out:cp:10D0C 10D1D 10D25}}</code></td></tr>
      <tr><td>Separate blocks are never joined</td><td id="s6"><div>{{cp:10D11 10D1D}}</div><div>{{cp:10D24}}</div></td><td><code>{{out:cp:10D11 10D1D}}</code> / (stray sign skipped)</td></tr>
    </tbody>
  </table>
</main>`),

  'tone-marks.html': layout('Tone marks and unsupported characters', `
<main>
  <h1>Tone marks, digits and unsupported characters</h1>
  <p>The <code>code</code> column is not converted by the extension, so you can compare it with the converted Hanifi column.</p>
  <table>
    <thead><tr><th>Case</th><th>Hanifi</th><th>Engine output</th></tr></thead>
    <tbody>
      <tr><td>Harbahay (stress, shown as acute)</td><td id="t1">{{cp:10D09 10D1F 10D24 10D13}}</td><td><code>{{out:cp:10D09 10D1F 10D24 10D13}}</code></td></tr>
      <tr><td>Tahala (long vowel, doubled)</td><td id="t2">{{cp:10D14 10D1D 10D25}}</td><td><code>{{out:cp:10D14 10D1D 10D25}}</code></td></tr>
      <tr><td>Tana (approximated with acute; warns)</td><td id="t3">{{cp:10D11 10D1D 10D26}}</td><td><code>{{out:cp:10D11 10D1D 10D26}}</code></td></tr>
      <tr><td>Tassi (doubled consonant)</td><td id="t4">{{cp:10D11 10D27 10D1D}}</td><td><code>{{out:cp:10D11 10D27 10D1D}}</code></td></tr>
      <tr><td>Na khonna (nasalisation)</td><td id="t5">{{cp:10D0F 10D1D 10D23}}</td><td><code>{{out:cp:10D0F 10D1D 10D23}}</code></td></tr>
      <tr><td>Sakin (dropped: no Latin equivalent)</td><td id="t6">{{cp:10D11 10D22}}</td><td><code>{{out:cp:10D11 10D22}}</code></td></tr>
      <tr><td>Kinna wa / kinna ya (same as wa / ya)</td><td id="t7">{{cp:10D17 10D1D 10D19 10D1D}}</td><td><code>{{out:cp:10D17 10D1D 10D19 10D1D}}</code></td></tr>
      <tr><td>Stray tone sign (skipped; warns)</td><td id="t8">x {{cp:10D24}}</td><td><code>{{out:cp:10D24}}</code></td></tr>
      <tr><td>Unassigned code point U+10D28 (kept; warns)</td><td id="t9">{{cp:10D11 10D1D 10D28}}</td><td><code>{{out:cp:10D11 10D1D 10D28}}</code></td></tr>
      <tr><td>Hanifi digits</td><td id="t10">{{cp:10D31 10D39 10D34 10D37}}</td><td><code>{{out:cp:10D31 10D39 10D34 10D37}}</code></td></tr>
      <tr><td>Arabic punctuation used with Hanifi (kept)</td><td id="t11">{{kitab}}، {{fúl}}؟ {{faní}}۔</td><td><code>{{out:kitab}}، {{out:fúl}}؟ {{out:faní}}۔</code></td></tr>
    </tbody>
  </table>
</main>`),

  'large-page.html': layout('Large page', `
<main>
  <h1>Large page (5,000 paragraphs)</h1>
  <p>Generated: <output id="generated">0</output> paragraphs.</p>
  <div id="rows"></div>
</main>`, {
    script: `
const WORDS = [${['kitab', 'fúl', 'faní', 'gór', 'eskul', 'zuban', 'manúic', 'rasta'].map(w => JSON.stringify(toHanifi(w))).join(', ')}];
const rows = document.getElementById('rows');
const frag = document.createDocumentFragment();
for (let i = 0; i < 5000; i++) {
  const p = document.createElement('p');
  p.innerHTML = (i + 1) + '. ' + WORDS[i % 8] + ' <a href="#r' + i + '">' + WORDS[(i + 3) % 8] + '</a> English ' + WORDS[(i + 5) % 8];
  frag.append(p);
}
rows.append(frag);
document.getElementById('generated').textContent = '5000';`,
  }),

  'frames-shadow.html': layout('Iframes and shadow DOM', `
<main>
  <h1>Iframes and shadow DOM (not converted in this release)</h1>
  <p id="top">Top-level page text converts: {{kitab}}</p>
  <p>Same-origin iframe:</p>
  <iframe id="frame" title="Iframe fixture" srcdoc="<p id='inner'>{{fúl}} {{faní}}</p>" width="400" height="60"></iframe>
  <p>Open shadow root:</p>
  <div id="shadow-host"></div>
</main>`, {
    script: `
const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
root.innerHTML = '<p id="in-shadow">${toHanifi('zuban')} ${toHanifi('lek')}</p>';`,
  }),
};

const index = layout('Index', `
<main>
  <h1>Rohingya Reader — demonstration fixtures</h1>
  <p>Open a page, click the Rohingya Reader toolbar button, and choose <strong>Convert this page</strong>. Each page states what should and should not change.</p>
  <ul>
    <li><a href="mixed-script.html">Mixed scripts, links and markup</a> — English, Arabic, Bengali, emoji; links keep working; attributes unchanged.</li>
    <li><a href="rtl-article.html">Right-to-left article</a> — whole page <code>dir="rtl"</code>; converted text reads left-to-right; <code>dir="auto"</code> block.</li>
    <li><a href="dynamic-feed.html">Dynamic feed</a> — new posts convert as they load; website edits and replacements after conversion.</li>
    <li><a href="editable.html">Editable fields and code</a> — inputs, textareas, rich-text editors, code and scripts stay unchanged.</li>
    <li><a href="split-words.html">Words split across elements</a> — tone signs and letters in separate inline elements.</li>
    <li><a href="tone-marks.html">Tone marks and unsupported characters</a> — compare with the engine's own output.</li>
    <li><a href="large-page.html">Large page</a> — 5,000 paragraphs; the page should stay responsive.</li>
    <li><a href="frames-shadow.html">Iframes and shadow DOM</a> — documented as not converted in this release.</li>
  </ul>
</main>`);

const css = `@font-face { font-family: 'Noto Sans Hanifi Rohingya'; src: url('NotoSansHanifiRohingya-Regular.woff2') format('woff2'); unicode-range: U+060C, U+061B, U+061F, U+0640, U+06D4, U+200C-200D, U+25CC, U+10D00-10D3F; }
body { font: 17px/1.6 'Segoe UI', system-ui, sans-serif, 'Noto Sans Hanifi Rohingya'; max-width: 860px; margin: 0 auto; padding: 16px 24px 48px; color: #1a1a1a; background: #fafaf8; }
h1 { color: #1a5c1a; line-height: 1.25; }
a { color: #1a5c1a; }
.banner { font-size: 13px; background: #fbf5e2; border: 1px solid #c9a227; border-radius: 8px; padding: 8px 12px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d9dcd6; padding: 6px 10px; text-align: start; vertical-align: top; }
code, kbd, pre { font-family: ui-monospace, Menlo, monospace, 'Noto Sans Hanifi Rohingya'; background: #f1f2ef; padding: 1px 4px; border-radius: 4px; }
.box { border: 1px dashed #4b5563; padding: 8px; margin: 8px 0; border-radius: 6px; }
.hl { background: #ecf5ec; }
.post { border-bottom: 1px solid #d9dcd6; padding: 4px 0; }
.controls button { margin: 2px 4px 2px 0; }
`;

await mkdir(path.join(out, 'assets'), { recursive: true });
await writeFile(path.join(out, 'assets/fixtures.css'), css);
await copyFile(path.join(root, 'assets/fonts/NotoSansHanifiRohingya-Regular.woff2'), path.join(out, 'assets/NotoSansHanifiRohingya-Regular.woff2'));
await writeFile(path.join(out, 'index.html'), index);
for (const [name, html] of Object.entries(pages)) await writeFile(path.join(out, name), html);
console.log(`Wrote ${Object.keys(pages).length + 1} fixture pages to ${path.relative(process.cwd(), out)}/`);

await copyFile(path.join(root, 'assets/fonts/OFL.txt'), path.join(out, 'assets/OFL.txt'));
