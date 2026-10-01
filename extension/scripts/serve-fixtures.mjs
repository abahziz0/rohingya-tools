// Static server for local testing (no dependencies).
//   http://127.0.0.1:4173/  -> extension/test/fixtures/   (demonstration pages)
// The port can be changed with FIXTURE_PORT.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

function serve(dir, port, label) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      const relative = path.relative(dir, file);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('outside root');
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = path.join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info) {
        const notFound = path.join(dir, '404.html');
        res.writeHead(404, { 'content-type': TYPES['.html'] });
        if (await stat(notFound).catch(() => null)) createReadStream(notFound).pipe(res);
        else res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(400).end('Bad request');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`${label}: http://127.0.0.1:${port}/`));
  return server;
}

serve(path.join(root, 'test/fixtures'), Number(process.env.FIXTURE_PORT ?? 4173), 'Fixtures');
