// What every probe needs to look at the real `ui-next` page: a production build of it, and a static server for that build.
//
//   const dist = await buildUiNext();        // OMNIVIEW_UI=next vite build into a temp dir (or DIST=<dir>, an existing build)
//   const { server, url, partsUrl } = await serve(dist);
//
// `url` is the root. The window's default screen is the pages the installed plugins contribute (nothing, in a static server); the kit's parts page, which every
// probe but the tooltip's looks at, is `partsUrl` (`/?screen=parts`), and the tooltip's stress page is `${url}?screen=tooltip-stress`.
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

/**
 * FONT_DELAY_MS=40 holds every font file back by that many milliseconds before it is answered, in every engine: a runner serves a font tens of
 * milliseconds after the request, which a local server hides (a face that is asked for late arrives after the first frame, and what was measured
 * in the fallback face swaps: docs/ui-next/status/1a.4d.md). Every probe that serves the page through this module takes it; unset, files go at once.
 * Known: WebKit in the Linux image (mcr.microsoft.com/playwright:v1.64.1-noble, arm64) marks the three faces `error` at the first frame from about
 * 40 ms (5 and 15 ms are fine, macOS WebKit and Chromium everywhere are fine at 40), so `fonts-probe` fails there under this knob; `main`'s own page
 * fails the same way (docs/ui-next/status/1a.3c.md), and CI does not set it.
 */
const FONT_DELAY_MS = Number(process.env.FONT_DELAY_MS ?? 0);

/** Serves `dist` on a free loopback port. A path outside it, or a missing file, is a 404 (never the page: a font must not come back as HTML). */
export function serve(dist) {
  // Absolute first: `DIST=./dist` joined onto a request path is `dist/index.html`, which does not start with `./dist`. The separator keeps a
  // sibling directory that begins with the same name (`dist-old`) outside.
  const root = path.resolve(dist);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      if (!file.startsWith(root + path.sep)) throw new Error('outside');
      const body = readFileSync(file);
      if (FONT_DELAY_MS > 0 && file.endsWith('.woff2')) await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
      response.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      resolve({ server, url, partsUrl: `${url}?screen=parts` });
    }),
  );
}
