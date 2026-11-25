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
      state = { windowId: undefined, path: undefined, streams: new Map(), pending: [], chain: Promise.resolve(), scheduled: false };
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
      state.path = new URL(page.url()).pathname;
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
          state.pending.push({ id, load: windowId, frame: toBase64(frame) });
          flush(page, state);
        },
        () => {
          // The stream stays addressable: a frame that was in flight when it was closed still reaches the host's `send` (which ignores it, unless a fault says otherwise).
          state.pending.push({ id, load: windowId, close: true });
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

  // The frame a page sends as it goes away must outlive the page: it goes as a keepalive request to a server of this process. Only that request is served: a POST to `/frame` with a small JSON body that names a load, a stream and a frame;
  // anything else is refused without reaching the host, and a body that cannot be read is a 400 and not a crash of the probe.
  const MAX_BODY = 4096;
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-headers', '*');
      response.writeHead(204).end();
      return;
    }

    const refuse = (status) => {
      response.writeHead(status, { 'content-type': 'application/json' }).end('{}');
    };

    if (request.method !== 'POST' || request.url !== '/frame') {
      refuse(404);
      return;
    }

    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        refuse(413);
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        refuse(400);
        return;
      }

      if (typeof body?.windowId !== 'string' || typeof body.id !== 'string' || typeof body.payload !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.payload)) {
        refuse(400);
        return;
      }

      const frame = fromBase64(body.payload);
      for (const state of pages.values()) {
        if (state.windowId === body.windowId) state.streams.get(body.id)?.send(frame);
      }

      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const shutDown = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };

  try {
    await context.addInitScript(`window.__hostBeacon = 'http://127.0.0.1:${String(server.address().port)}/frame';`);
  } catch (error) {
    // The bridge was not set up: the listener does not stay open.
    await shutDown();
    throw error;
  }

  context.on('page', (page) => {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      // A document that replaces the fixture's (another path, or a blank page) ends the streams of the old one, whether or not the page said it was leaving; a navigation inside the same document (the address's query or hash) does not.
      const state = pages.get(page);
      if (frame.url() === 'about:blank' || (state?.path !== undefined && new URL(frame.url()).pathname !== state.path)) retire(page);
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
      await shutDown();
    },
  };
}
