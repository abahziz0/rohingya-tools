// Renders extension icons and Chrome Web Store promo images from HTML/SVG
// using Playwright's Chromium. Output:
//   assets/icons/icon-{16,32,48,128}.png         (packaged in the extension)
//   docs/store-assets/store-icon-128.png         (store listing icon)
//   docs/store-assets/small-promo-440x280.png    (required small promo tile)
//   docs/store-assets/marquee-1400x560.png       (optional marquee)
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'docs/store-assets'), { recursive: true });
const font = (await readFile(path.join(root, 'assets/fonts/NotoSansHanifiRohingya-Regular.woff2'))).toString('base64');

const GREEN = '#1a5c1a';
const DARK = '#134513';
const GOLD = '#c9a227';

// Hanifi letter code points used in the icon and promo artwork.
const RA = String.fromCodePoint(0x10d0c);

/** The mark: green rounded square, white "R", gold diamond; optional Hanifi letter. */
function mark(size, { hanifi }) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${DARK}"/></linearGradient></defs>
    <rect x="0" y="0" width="96" height="96" rx="${hanifi ? 20 : 18}" fill="url(#g)"/>
    ${hanifi ? `<text x="72" y="36" font-family="Hanifi" font-size="30" fill="${GOLD}" text-anchor="middle">${RA}</text>` : ''}
    <text x="${hanifi ? 38 : 45}" y="${hanifi ? 77 : 79}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${hanifi ? 68 : 80}" fill="#fff" text-anchor="middle">R</text>
    <path d="M${hanifi ? 77 : 80} ${hanifi ? 62 : 64} l9 9 -9 9 -9 -9z" fill="${GOLD}"/>
  </svg>`;
}

const page = (body, w, h, bg = 'transparent') => `<!doctype html><html><head><style>
  @font-face { font-family: Hanifi; src: url(data:font/woff2;base64,${font}) format('woff2'); }
  html,body{margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;font-family:Helvetica,Arial,sans-serif}
</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();

async function shot(html, w, h, out, transparent = true) {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(root, out), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote', out);
}

// Toolbar sizes fill the canvas; 48/128 keep Chrome's recommended transparent padding.
await shot(page(mark(16, { hanifi: false }), 16, 16), 16, 16, 'assets/icons/icon-16.png');
await shot(page(mark(30, { hanifi: false }), 32, 32), 32, 32, 'assets/icons/icon-32.png');
await shot(page(mark(40, { hanifi: true }), 48, 48), 48, 48, 'assets/icons/icon-48.png');
await shot(page(mark(96, { hanifi: true }), 128, 128), 128, 128, 'assets/icons/icon-128.png');
await shot(page(mark(96, { hanifi: true }), 128, 128), 128, 128, 'docs/store-assets/store-icon-128.png');

const letters = [[0x10d0c, 'r'], [0x10d1f, 'u'], [0x10d1d, 'a'], [0x10d07, 'h'], [0x10d11, 'k']]
  .map(([cp, l]) => `<span class="pair"><span class="h">${String.fromCodePoint(cp)}</span><span class="arr">→</span><span class="l">${l}</span></span>`)
  .join('');

const promo = (w, h, scale) => page(`
  <style>
    .wrap{box-sizing:border-box;width:${w}px;height:${h}px;padding:${28 * scale}px ${32 * scale}px;background:linear-gradient(135deg,${GREEN},${DARK});color:#fff;display:flex;flex-direction:column;justify-content:center;gap:${14 * scale}px}
    .top{display:flex;align-items:center;gap:${16 * scale}px}
    h1{margin:0;font-size:${34 * scale}px;line-height:1.1}
    p{margin:${6 * scale}px 0 0;font-size:${15 * scale}px;color:#f3e7bd}
    .pairs{display:flex;gap:${8 * scale}px;flex-wrap:nowrap}
    .pair{display:inline-flex;align-items:center;gap:${6 * scale}px;background:rgba(255,255,255,.1);border:1px solid rgba(201,162,39,.6);border-radius:${10 * scale}px;padding:${4 * scale}px ${8 * scale}px}
    .h{font-family:Hanifi;font-size:${24 * scale}px;color:${GOLD}}
    .arr{font-size:${14 * scale}px;opacity:.7}
    .l{font-size:${22 * scale}px;font-weight:700}
    .foot{font-size:${13 * scale}px;opacity:.85}
  </style>
  <div class="wrap">
    <div class="top">${mark(72 * scale, { hanifi: true })}<div><h1>Rohingya Reader</h1><p>Read Hanifi webpages in Rohingyalish</p></div></div>
    <div class="pairs">${letters}</div>
    <div class="foot">Converts on your device · rohingyalanguage.org</div>
  </div>`, w, h, GREEN);

await shot(promo(440, 280, 1), 440, 280, 'docs/store-assets/small-promo-440x280.png', false);
await shot(promo(1400, 560, 2.2), 1400, 560, 'docs/store-assets/marquee-1400x560.png', false);

await browser.close();
