// What every probe needs to look at the real `ui-next` page: a production build of it, and a static server for that build.
//
//   const dist = await buildUiNext();        // OMNIVIEW_UI=next vite build into a temp dir (or DIST=<dir>, an existing build)
//   const { server, url } = await serve(dist);
//
// The page imports the BUILT kit, so build the kit first (`pnpm --filter @omniviewdev/kit run build`, or `task packages`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

/** A production build of `ui-next` in a temp directory, or the directory in DIST. */
export function buildUiNext() {
  if (process.env.DIST) return process.env.DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'kit-probe-'));
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', OMNIVIEW_BUILD_OUTPUT_DIRECTORY: out }, stdio: 'pipe' });
  return out;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/** Serves `dist` on a free loopback port. A path outside it, or a missing file, is a 404 (never the page: a font must not come back as HTML). */
export function serve(dist) {
  // Absolute first: `DIST=./dist` joined onto a request path is `dist/index.html`, which does not start with `./dist`. The separator keeps a
  // sibling directory that begins with the same name (`dist-old`) outside.
  const root = path.resolve(dist);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      if (!file.startsWith(root + path.sep)) throw new Error('outside');
      response.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      response.end(readFileSync(file));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}
