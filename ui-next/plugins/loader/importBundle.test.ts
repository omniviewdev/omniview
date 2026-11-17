import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BundleTimeoutError, IncompatibleBundleError, classify } from './failure';
import { clearBundle, entryUrl, importBundle } from './importBundle';
import { systemJs } from './systemjs';

// The loader against the real SystemJS and a faked `fetch`: SystemJS fetches the plugin's file through the hook the loader installs, the host reads what
// the bundle imports, and only then does SystemJS evaluate it. What the Go host serves (the allow-list, `no-store`, status 400 for a file it cannot read)
// is stood in for by a response; the browser check runs the real host.

const ANSWER = 'System.register(["react"],function(e){var r;return{setters:[function(m){r=m}],execute:function(){e("answer",typeof r.useState)}}});';

type Served = { readonly status?: number; readonly body: string } | 'hang';

let files: Record<string, Served> = {};

async function respond(url: string): Promise<Response> {
  const served = files[url];
  if (served === 'hang') {
    return new Promise<Response>(() => undefined);
  }

  if (served === undefined) {
    return Promise.resolve(new Response('Could not load file', { status: 400, statusText: 'Bad Request' }));
  }

  return Promise.resolve(new Response(served.body, { status: served.status ?? 200, headers: { 'content-type': 'application/javascript' } }));
}

beforeEach(() => {
  files = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, '__ran');
});

describe('importBundle', () => {
  it('fetches a plugin\'s bundle where the Go host serves it and links it to the host\'s React', async () => {
    files[entryUrl('acme')] = { body: ANSWER };

    const loaded = await importBundle('acme');

    expect(entryUrl('acme')).toBe(`${window.location.origin}/_/plugins/acme/assets/entry.js`);
    expect(loaded).toMatchObject({ answer: 'function' });
  });

  it('refuses a bundle that imports what the host does not serve, and runs none of it', async () => {
    files[entryUrl('old')] = { body: 'System.register(["@omniviewdev/base-ui"],function(){return{execute:function(){window.__ran=true}}});' };

    const failure = await importBundle('old').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IncompatibleBundleError);
    expect(failure).toMatchObject({ names: ['@omniviewdev/base-ui'] });
    expect(Reflect.get(window, '__ran')).toBeUndefined();
    expect(classify(failure).kind).toBe('incompatible');
  });

  it('reports a file the host could not read as the status it answered', async () => {
    const failure = await importBundle('absent').catch((error: unknown) => error);

    expect(String(failure)).toContain('400 Bad Request');
    expect(classify(failure).kind).toBe('missing');
  });

  it('reports a bundle that threw when it ran as broken', async () => {
    files[entryUrl('thrower')] = { body: 'System.register([],function(){return{execute:function(){throw new Error("exploded at start")}}});' };

    const failure = await importBundle('thrower').catch((error: unknown) => error);

    expect(classify(failure)).toMatchObject({ kind: 'broken', detail: 'exploded at start' });
  });

  it('gives up on a bundle that never arrives', async () => {
    files[entryUrl('slow')] = 'hang';

    const failure = await importBundle('slow', 25).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BundleTimeoutError);
    expect(classify(failure).kind).toBe('timeout');
  });
});

describe('clearBundle', () => {
  const chunk = (id: string) => `${window.location.origin}/_/plugins/${id}/assets/chunk.js`;
  const generation = (value: string) => `System.register([],function(e){return{execute:function(){e("value",${JSON.stringify(value)})}}});`;
  const entry = 'System.register(["./chunk.js"],function(e){var c;return{setters:[function(m){c=m}],execute:function(){e("read",function(){return c.value})}}});';
  /** What the entry above reads from its chunk, through the loader. */
  const readOf = async (id: string): Promise<{ read: () => string }> => {
    const loaded = await importBundle(id);
    return { read: () => String(Reflect.get(Object(loaded), 'read')()) };
  };

  it('drops a plugin\'s entry and its chunks, so an upgrade never links a new entry to an old chunk', async () => {
    files[entryUrl('upgrade')] = { body: entry };
    files[chunk('upgrade')] = { body: generation('old') };
    const first = await readOf('upgrade');
    expect(first.read()).toBe('old');

    files[chunk('upgrade')] = { body: generation('new') };
    clearBundle('upgrade');
    const second = await readOf('upgrade');

    expect(second.read()).toBe('new');
  });

  it('lets a plugin that failed once load again: SystemJS keeps a failure until the module is dropped', async () => {
    const failed = await importBundle('flaky').catch((error: unknown) => error);
    expect(classify(failed).kind).toBe('missing');

    files[entryUrl('flaky')] = { body: ANSWER };
    clearBundle('flaky');

    expect(await importBundle('flaky')).toMatchObject({ answer: 'function' });
  });

  it('leaves another plugin alone, including one whose id starts the same', async () => {
    files[entryUrl('keep')] = { body: ANSWER };
    files[entryUrl('keep-too')] = { body: ANSWER };
    await importBundle('keep');
    await importBundle('keep-too');

    clearBundle('keep');

    expect(systemJs.has(entryUrl('keep'))).toBe(false);
    expect(systemJs.has(entryUrl('keep-too'))).toBe(true);
  });
});
