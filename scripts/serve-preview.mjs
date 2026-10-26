#!/usr/bin/env node
/**
 * Minimal static server for previewing a production build (`npm run build`).
 *
 * Why not `vite preview`? This has no host checks, no dev-only middleware and no
 * websocket — it behaves like the plain file host you would deploy to, which is
 * exactly what a phone preview needs. On a real host (Pages, Netlify, S3, nginx)
 * you do not need this file at all.
 *
 * Usage: node scripts/serve-preview.mjs [port]   (default 5173)
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const root = new URL('../dist/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build found at ${root} — run "npm run build" first.`);
  process.exit(1);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(root, requested);

    // Never serve outside dist/.
    if (!filePath.startsWith(root.endsWith(sep) ? root : root + sep)) {
      send(res, 403, 'Forbidden');
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    // Hash routing means every unknown path is the app shell.
    if (!existsSync(filePath)) filePath = join(root, 'index.html');

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 500, `Preview server error: ${String(error)}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Previewing static build on http://0.0.0.0:${port}/ (dist/)`);
});
