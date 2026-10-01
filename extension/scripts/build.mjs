// Builds the unpacked extension.
//   node scripts/build.mjs          -> dist/        (release build)
//   node scripts/build.mjs --test   -> dist-test/   (adds host access to 127.0.0.1 for automated tests)
//   node scripts/build.mjs --watch  -> dist/, rebuilding on change
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const testBuild = args.has('--test');
const outdir = path.join(root, testBuild ? 'dist-test' : 'dist');

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'inline',
  // Readable output: easier for store review; no source maps in the package.
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
};

const entries = [
  { in: 'src/content/index.ts', out: 'content.js' },
  { in: 'src/background/index.ts', out: 'background.js' },
  { in: 'src/popup/popup.ts', out: 'popup/popup.js' },
];

async function writeManifest() {
  const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  if (testBuild) {
    manifest.name = `${manifest.name} (test build)`;
    // Automated tests cannot click the toolbar button (which grants activeTab)
    // or answer Chrome's permission prompt, so the test build is pre-granted
    // access to the local fixture server only. Never ship this build.
    manifest.host_permissions = ['*://127.0.0.1/*'];
  }
  await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function copyStatic() {
  await mkdir(path.join(outdir, 'popup'), { recursive: true });
  await mkdir(path.join(outdir, 'icons'), { recursive: true });
  await mkdir(path.join(outdir, 'fonts'), { recursive: true });
  await cp(path.join(root, 'src/popup/popup.html'), path.join(outdir, 'popup/popup.html'));
  await cp(path.join(root, 'src/popup/popup.css'), path.join(outdir, 'popup/popup.css'));
  for (const size of [16, 32, 48, 128]) {
    await cp(path.join(root, `assets/icons/icon-${size}.png`), path.join(outdir, `icons/icon-${size}.png`));
  }
  // Same self-hosted font the website uses (SIL OFL 1.1), for Hanifi examples in the popup.
  await cp(path.join(root, 'assets/fonts/NotoSansHanifiRohingya-Regular.woff2'), path.join(outdir, 'fonts/NotoSansHanifiRohingya-Regular.woff2'));
  await cp(path.join(root, 'assets/fonts/OFL.txt'), path.join(outdir, 'fonts/OFL.txt'));
  await cp(path.join(root, '../LICENSE'), path.join(outdir, 'LICENSE.txt'));
  await writeManifest();
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = entries.map(e => ({
  ...common,
  entryPoints: [path.join(root, e.in)],
  outfile: path.join(outdir, e.out),
}));

if (args.has('--watch')) {
  await copyStatic();
  for (const o of options) await (await context(o)).watch();
  console.log(`Watching; output in ${path.relative(process.cwd(), outdir)}/`);
} else {
  await Promise.all(options.map(o => build(o)));
  await copyStatic();
  console.log(`Built ${testBuild ? 'TEST ' : ''}extension ${pkg.version} -> ${path.relative(process.cwd(), outdir) || '.'}/`);
}
