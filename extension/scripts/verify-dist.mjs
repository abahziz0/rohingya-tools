// Verifies the Chrome Web Store ZIP (release/rohingya-reader-<version>.zip):
//  - manifest.json is at the ZIP root and is a release (not test) build
//  - every file referenced by the manifest, popup HTML and CSS exists
//  - only expected file types; no node_modules, sources, maps, env files or secrets
//  - no remotely hosted code (external scripts, eval, new Function, remote imports)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zipPath = path.join(root, 'release', `rohingya-reader-${pkg.version}.zip`);
const zip = await readFile(zipPath);

// --- read the ZIP central directory
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error('Not a ZIP file');
const count = zip.readUInt16LE(eocd + 10);
let p = zip.readUInt32LE(eocd + 16);
const files = new Map();
for (let i = 0; i < count; i++) {
  const method = zip.readUInt16LE(p + 10);
  const size = zip.readUInt32LE(p + 20);
  const nameLen = zip.readUInt16LE(p + 28);
  const extraLen = zip.readUInt16LE(p + 30);
  const commentLen = zip.readUInt16LE(p + 32);
  const localOffset = zip.readUInt32LE(p + 42);
  const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
  const lNameLen = zip.readUInt16LE(localOffset + 26);
  const lExtraLen = zip.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + lNameLen + lExtraLen;
  const raw = zip.subarray(start, start + size);
  files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
  p += 46 + nameLen + extraLen + commentLen;
}

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};
const text = name => files.get(name)?.toString('utf8') ?? '';

// --- manifest
check(files.has('manifest.json'), 'manifest.json is not at the ZIP root');
check(text('LICENSE.txt') === await readFile(path.join(root, '../LICENSE'), 'utf8'), 'MIT license missing or changed');
check(text('fonts/OFL.txt') === await readFile(path.join(root, 'assets/fonts/OFL.txt'), 'utf8'), 'font license missing or changed');
const manifest = JSON.parse(text('manifest.json'));
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(manifest.version === pkg.version, `manifest version ${manifest.version} != package.json ${pkg.version}`);
check(!manifest.host_permissions, 'release manifest must not declare host_permissions (test build?)');
check(!/test build/i.test(manifest.name), 'release manifest name mentions a test build');
check(manifest.name.length <= 75, 'name longer than 75 characters');
check(manifest.description.length <= 132, 'description longer than 132 characters');
const allowedPermissions = ['activeTab', 'scripting', 'storage'];
check(JSON.stringify(manifest.permissions) === JSON.stringify(allowedPermissions), `unexpected permissions: ${manifest.permissions}`);
check(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(['*://*/*']), 'unexpected optional_host_permissions');
check(!manifest.content_scripts, 'no static content scripts expected (access is requested per website)');

const referenced = new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  'content.js', // injected via chrome.scripting
].filter(Boolean));

// popup HTML and CSS references
for (const [name] of files) {
  const dir = path.posix.dirname(name);
  if (name.endsWith('.html')) {
    for (const m of text(name).matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^https?:/.test(ref)) {
        check(/^https:\/\/rohingyalanguage\.org\//.test(ref), `${name}: unexpected external link ${ref}`);
        check(!new RegExp(`<script[^>]+src="${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(text(name)), `${name}: remote script ${ref}`);
        continue;
      }
      referenced.add(path.posix.normalize(path.posix.join(dir, ref)));
    }
  }
  if (name.endsWith('.css')) {
    for (const m of text(name).matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) referenced.add(path.posix.normalize(path.posix.join(dir, m[1])));
  }
}
for (const ref of referenced) check(files.has(ref), `referenced file missing from ZIP: ${ref}`);

// --- contents
const allowedExt = /\.(js|html|css|json|png|woff2|txt)$/;
for (const [name, data] of files) {
  check(allowedExt.test(name), `unexpected file type: ${name}`);
  check(!/(^|\/)(node_modules|src|test|scripts|docs)\//.test(name), `development file in ZIP: ${name}`);
  check(!/\.(ts|map|mjs)$|(^|\/)\.env|\.pem$|\.key$|\.crx$/.test(name), `development or secret file in ZIP: ${name}`);
  check(!name.startsWith('.') && !name.includes('/.'), `hidden file in ZIP: ${name}`);
  if (/\.(js|html|css|json|txt)$/.test(name)) {
    const s = data.toString('utf8');
    check(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9]{20,}/.test(s), `possible secret in ${name}`);
  }
  if (name.endsWith('.js')) {
    const s = data.toString('utf8');
    check(!/\beval\s*\(/.test(s), `${name}: eval() found`);
    check(!/\bnew\s+Function\s*\(/.test(s), `${name}: new Function() found`);
    check(!/\bimport\s*\(\s*['"`]https?:/.test(s), `${name}: remote dynamic import`);
    check(!/importScripts\s*\(/.test(s), `${name}: importScripts()`);
    check(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(s), `${name}: network API used`);
    const urls = [...s.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map(m => m[0]);
    for (const url of urls) {
      check(/^https:\/\/rohingyalanguage\.org\//.test(url) || /^http:\/\/www\.w3\.org\//.test(url), `${name}: unexpected URL ${url}`);
    }
  }
}
const unreferenced = [...files.keys()].filter(f => !referenced.has(f) && !['fonts/OFL.txt', 'LICENSE.txt', 'manifest.json'].includes(f));
check(unreferenced.length === 0, `files not referenced by anything: ${unreferenced.join(', ')}`);

const size = zip.length;
console.log(`Checked ${path.relative(process.cwd(), zipPath)}: ${files.size} files, ${size} bytes`);
for (const name of [...files.keys()].sort()) console.log(`  ${name} (${files.get(name).length} bytes)`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const pr of problems) console.error(`  ✗ ${pr}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
