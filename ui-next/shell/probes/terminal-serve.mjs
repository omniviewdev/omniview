// Serves the probe's terminal host (terminal-host.mjs, which holds the terminal channel's far end) to every page of a Playwright browser context, so that the host outlives a reload of the page and is shared by a second page: the fixture page
// (terminal-fixture.tsx, `?host=shared`) forwards the calls of its `ExecClient` and the window's state to `window.__host(method, args)`, opens its streams through `window.__hostStream(op, id, payload)` and receives what the host sends on them from
// `window.__hostFrames(frames)`. This file is the only part of the probe's far end that knows Node or Playwright: the host itself is plain JavaScript.
//
// A stream is a connection of a page: when the page goes away (it loads another document, navigates to a blank page, or closes) every stream it opened is closed, as the transport of the real host closes the streams of a page that is gone, and
// the host does what it does for any end of a stream (the terminal is detached, its lease runs). Frames that reach the page after its document was replaced are never handed to the new document: a stream is named by the page load that opened it.
// The frames a page sends are applied in the order it sent them (a stream is one ordered connection). A `detach` frame is the one a page sends as it goes away: through the binding it is dropped with the page in Chromium, so it travels as a request
// that outlives the page (`keepalive`), to a server of this process, as the page's own detach does on the real host's stream.
import { createServer } from 'node:http';
import { fromBase64, toBase64 } from './terminal-host.mjs';

/**
 * @param {import('playwright').BrowserContext} context
 * @param {ReturnType<typeof import('./terminal-host.mjs').createHost>} host
 */
export async function serveContext(context, host) {
  /** For each page: the load that is current (`windowId`), the streams it opened (by the page's own id), and the frames waiting to be handed to it. */
  const pages = new Map();


  const stateOf = (page) => {
    let state = pages.get(page);
    if (state === undefined) {
      state = { windowId: undefined, streams: new Map(), pending: [], chain: Promise.resolve(), scheduled: false };
      pages.set(page, state);
    }

    return state;
  };

  /** What the host sent on the page's streams, handed over in the order it was sent: everything that came in one task goes in one call. */
  const flush = (page, state) => {
    if (state.scheduled) return;
    state.scheduled = true;
    state.chain = state.chain.then(async () => {
      state.scheduled = false;
      const batch = state.pending.splice(0);
      if (batch.length === 0) return;
      await page.evaluate((frames) => window.__hostFrames?.(frames), batch).catch(() => undefined);
    });
  };

  /** The page went away: its streams end, and the host sees the end of each. */
  const retire = (page) => {
    const state = pages.get(page);
    if (state === undefined) return;
    pages.delete(page);
    for (const stream of state.streams.values()) stream.close();
    state.streams.clear();
  };

  await context.exposeBinding('__host', async ({ page }, windowId, method, args) => {
    const state = stateOf(page);
    if (method === 'hello') {
      // A page that loaded again is a new load of the same page: the streams of the old one end.
      if (state.windowId !== undefined && state.windowId !== windowId) {
        for (const stream of state.streams.values()) stream.close();
        state.streams.clear();
      }

      state.windowId = windowId;
      return null;
    }

    return host.call(method, args);
  });

  await context.exposeBinding('__hostStream', async ({ page }, windowId, op, id, payload) => {
    const state = stateOf(page);
    if (state.windowId !== windowId) return;
    if (op === 'open') {
      const stream = host.openStream(
        (frame) => {
          state.pending.push({ id, frame: toBase64(frame) });
          flush(page, state);
        },
        () => {
          // The stream stays addressable: a frame that was in flight when it was closed still reaches the host's `send` (which ignores it, unless a fault says otherwise).
          state.pending.push({ id, close: true });
          flush(page, state);
        },
      );
      state.streams.set(id, stream);
    } else if (op === 'send') {
      state.streams.get(id)?.send(fromBase64(payload));
    } else if (op === 'close') {
      state.streams.get(id)?.close();
    }
  });

  // The frame a page sends as it goes away must outlive the page: it goes as a keepalive request to a server of this process.
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-headers', '*');
      response.writeHead(204).end();
      return;
    }

    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const { windowId, id, payload } = JSON.parse(Buffer.concat(chunks).toString());
      for (const state of pages.values()) {
        if (state.windowId === windowId) state.streams.get(id)?.send(fromBase64(payload));
      }

      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await context.addInitScript(`window.__hostBeacon = 'http://127.0.0.1:${String(server.address().port)}/frame';`);
  context.on('page', (page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() === 'about:blank') retire(page);
    });
    page.on('close', () => {
      retire(page);
    });
  });

  return {
    /** The streams the page holds now, by the page's own ids (a probe asks how many a page has open). */
    streamsOf: (page) => [...(pages.get(page)?.streams.keys() ?? [])],
    close: async () => {
      for (const page of [...pages.keys()]) retire(page);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
