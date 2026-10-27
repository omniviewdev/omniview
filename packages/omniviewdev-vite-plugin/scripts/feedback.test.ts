import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import {
  chmodSync, closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, mkdtempSync, openSync,
  realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { get } from 'node:http';
import type { ClientRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createVite5, version as vite5Version } from 'vite';
import type { HMRPayload, ViteDevServer as Vite5DevServer } from 'vite';
import { createServer as createVite8, version as vite8Version } from '../../../node_modules/vite/dist/node/index.js';
import type { ViteDevServer as Vite8DevServer } from '../../../node_modules/vite/dist/node/index.js';
import { omniviewExternals } from '../src/index';
import { managedViteFeedback, readViteFeedbackAuthority } from '../src/feedback';

function serverOptions(root: string, hotUpdates: EventEmitter) {
  return {
    root: path.join(root, 'workspace'),
    configFile: false as const,
    logLevel: 'silent' as const,
    cacheDir: path.join(root, 'cache'),
    plugins: [
      {
        name: 'observe-real-feedback-publication',
        handleHotUpdate({ file }: { file: string }) {
          // The raw watcher fires before Vite awaits watchChange and invalidates
          // its graph. Observe the actual HMR lifecycle before requesting source.
          hotUpdates.emit('change', file);
        },
      },
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, watch: { ignored: [path.join(root, 'runtime')] } },
  };
}

const frameworks = [
  {
    name: 'Vite 5', major: 5, version: vite5Version,
    createServer(root: string, hotUpdates: EventEmitter) {
      const options = serverOptions(root, hotUpdates);
      return createVite5({ ...options, plugins: [omniviewExternals(), ...options.plugins] });
    },
  },
  {
    name: 'Vite 8', major: 8, version: vite8Version,
    createServer(root: string, hotUpdates: EventEmitter) {
      const options = serverOptions(root, hotUpdates);
      return createVite8({ ...options, plugins: [managedViteFeedback(), ...options.plugins] });
    },
  },
];
type Framework = typeof frameworks[number];
type FixtureServer = Vite5DevServer | Vite8DevServer;
type NavigationPayload = Extract<HMRPayload, { type: 'update' | 'prune' | 'full-reload' }>;
type Feedback = { type: string; [key: string]: unknown };
const navigationTypes: Record<string, true> = { update: true, 'full-reload': true, prune: true };

async function fixture(t: TestContext, framework: Framework, managed = true, initiallyHeld = true) {
  assert.equal(Number(framework.version.split('.')[0]), framework.major, 'exercise two actual installed Vite majors');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview feedback ')));
  const workspaceRoot = path.join(root, 'workspace');
  const runtime = path.join(root, 'runtime');
  mkdirSync(workspaceRoot);
  mkdirSync(runtime, { mode: 0o700 });
  const file = path.join(runtime, 'vite-feedback-generation.json');
  const context = {
    schemaVersion: 1,
    workspaceID: '29e183ad-de9b-42bd-8f61-3cfa5e3ea933',
    generation: 'feedback-network-regression',
    workspaceRoot,
  };
  const descriptor = openSync(file, 'wx+', 0o600);
  const publishRaw = (raw: string) => {
    // Match the supervisor's stable-inode, bounded in-place publication, not rename.
    const bytes = Buffer.from(raw);
    writeSync(descriptor, bytes, 0, bytes.length, 0);
    if (fstatSync(descriptor).size > bytes.length) ftruncateSync(descriptor, bytes.length);
    fsyncSync(descriptor);
  };
  const publish = (held: boolean) => publishRaw(JSON.stringify({ ...context, held }));
  publish(initiallyHeld);
  writeFileSync(path.join(workspaceRoot, 'index.html'), '<html><body>initial<script type="module" src="/main.js"></script></body></html>');
  writeFileSync(path.join(workspaceRoot, 'main.js'), 'import { value } from "./value.js"; console.log(value); import.meta.hot.accept("./value.js", () => {}); import.meta.hot.accept();');
  writeFileSync(path.join(workspaceRoot, 'value.js'), 'export const value = "initial";');

  const environmentKeys = ['OMNIVIEW_VITE_FEEDBACK', 'OMNIVIEW_VITE_ALLOWED_ROOTS', 'OMNIVIEW_VITE_PORT', 'OMNIVIEW_VITE_CACHE_DIRECTORY', 'OMNIVIEW_BUILD_OUTPUT_DIRECTORY'] as const;
  const previousEnvironment = environmentKeys.map(key => [key, process.env[key]] as const);
  for (const key of environmentKeys) delete process.env[key];
  if (managed) process.env.OMNIVIEW_VITE_FEEDBACK = JSON.stringify({ ...context, file });
  let server: FixtureServer | undefined;
  const sockets: WebSocket[] = [];
  const requests: ClientRequest[] = [];
  const hotUpdates = new EventEmitter();
  t.after(async () => {
    for (const socket of sockets) socket.close();
    for (const request of requests) request.destroy();
    try { await server?.close(); }
    finally {
      closeSync(descriptor);
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
  server = await framework.createServer(root, hotUpdates);
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const messages: Feedback[] = [];
  const token = server.config.webSocketToken;
  const wsURL = `${origin.replace('http:', 'ws:')}/?token=${encodeURIComponent(token)}`;
  const connect = async () => {
    const connectedBefore = messages.filter(message => message.type === 'connected').length;
    const socket = new WebSocket(wsURL, 'vite-hmr');
    sockets.push(socket);
    socket.addEventListener('message', event => messages.push(JSON.parse(String(event.data)) as Feedback));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('HMR transport did not open')), { once: true });
    });
    await eventually(() => messages.filter(message => message.type === 'connected').length > connectedBefore, 'real HMR connection');
    return socket;
  };
  const socket = await connect();
  const read = async (name: string) => {
    const response = await fetch(`${origin}/${name}`);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return body;
  };
  await read('index.html');
  await read('main.js');
  await read('value.js');
  messages.length = 0;

  const change = async (name: string, contents: string) => {
    const target = path.join(workspaceRoot, name);
    let published = false;
    const observe = (changedPath: string) => {
      if (changedPath === target) published = true;
    };
    hotUpdates.on('change', observe);
    try {
      writeFileSync(target, contents);
      await eventually(() => published, `real HMR publication for ${name}`);
      assert.ok((await read(name)).includes(contents.includes('changed') ? 'changed' : contents));
    } finally {
      hotUpdates.off('change', observe);
    }
    // A negative network assertion needs a bounded quiet window after the real
    // HMR lifecycle event and successful fresh transformation, not a mocked send.
    await delay(150);
  };
  const httpPing = () => {
    let fulfilled = false;
    const request = get(origin, { headers: { accept: 'text/x-vite-ping' } }, response => {
      // Vite 5's browser fetch treats EVERY HTTP status as successful reconnect.
      fulfilled = true;
      response.resume();
    });
    request.on('error', () => {});
    requests.push(request);
    return { request, fulfilled: () => fulfilled };
  };
  const websocketPing = () => {
    let opened = false;
    const probe = new WebSocket(wsURL, 'vite-ping');
    sockets.push(probe);
    probe.addEventListener('open', () => { opened = true; });
    probe.addEventListener('error', () => {});
    return { socket: probe, opened: () => opened };
  };
  const navigation = () => messages.filter(message => navigationTypes[message.type]);
  return { server, root, workspaceRoot, file, context, publish, publishRaw, read, change, messages, navigation, httpPing, websocketPing, hotUpdates, socket, connect };
}

async function eventually(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await delay(10);
  }
}

const authorityExecutable = process.env.OMNIVIEW_TEST_VITE_FEEDBACK_EXECUTABLE;
test('real supervisor authority subprocess rereads state and refuses foreign or replaced ownership', {
  timeout: 10000,
  skip: process.platform === 'win32'
    ? 'Portable Unix identity fixture; Windows full file-ID/DACL fixtures live in Go'
    : !authorityExecutable && 'Set OMNIVIEW_TEST_VITE_FEEDBACK_EXECUTABLE to the built supervisor CLI',
}, async t => {
  const f = await fixture(t, frameworks[0]);
  const stat = statSync(f.file, { bigint: true });
  const authority = {
    executable: realpathSync(authorityExecutable!),
    identity: { volume: stat.dev.toString(), fileID: stat.ino.toString(16).padStart(32, '0') },
  };
  const raw = JSON.stringify({ ...f.context, file: f.file, authority });
  assert.equal(readViteFeedbackAuthority(raw), true);
  f.publish(false);
  assert.equal(readViteFeedbackAuthority(raw), false, 'real same-inode readiness must release');
  f.publish(true);
  assert.equal(readViteFeedbackAuthority(raw), true, 'each subprocess read must see a new hold');
  f.publishRaw('{');
  assert.equal(readViteFeedbackAuthority(raw), true);
  f.publishRaw(JSON.stringify({ ...f.context, generation: 'foreign', held: false }));
  assert.equal(readViteFeedbackAuthority(raw), true);
  f.publish(false);
  assert.equal(readViteFeedbackAuthority(raw), false, 'same-inode repair remains releasable');
  chmodSync(f.file, 0o644);
  assert.equal(readViteFeedbackAuthority(raw), true, 'helper must enforce actual platform authority');
  chmodSync(f.file, 0o600);
  renameSync(f.file, `${f.file}.owned`);
  writeFileSync(f.file, JSON.stringify({ ...f.context, held: false }), { mode: 0o600 });
  assert.equal(readViteFeedbackAuthority(raw), true, 'identical JSON on a new inode is not authority');
  rmSync(f.file);
  symlinkSync(`${f.file}.owned`, f.file);
  assert.equal(readViteFeedbackAuthority(raw), true, 'even a symlink to the original inode is refused');
  assert.equal(readViteFeedbackAuthority(JSON.stringify({
    ...f.context, file: f.file, authority: { ...authority, executable: `${f.file}.owned` },
  })), true, 'a real failed executable invocation must fail closed');
});

for (const framework of frameworks) {
  test(`${framework.name}: development status rejects foreign generations and exposes only banner fields`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    const local = path.join(f.workspaceRoot, '.local');
    mkdirSync(local, { mode: 0o700 });
    const file = path.join(local, 'launch-status.json');
    const status = {
      generation: f.context.generation,
      manifest: { workspaceID: f.context.workspaceID },
      launchPhase: 'build-error',
      failedStage: 'host-backend',
      lastError: { message: 'PRIVATE_COMPILER_DIAGNOSTIC' },
    };
    const endpoint = `${f.server.resolvedUrls!.local[0]}__omniview_development_status`;
    writeFileSync(file, JSON.stringify(status), { mode: 0o600 });
    let response = await fetch(endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      phase: 'build-error',
      failedStage: 'host-backend',
      recoveryCommand: `omniview-dev workspace refresh ${f.context.workspaceID}`,
    });
    writeFileSync(file, JSON.stringify({ ...status, generation: 'foreign' }));
    response = await fetch(endpoint);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), '');
    writeFileSync(file, JSON.stringify(status));
    if (process.platform !== 'win32') {
      chmodSync(file, 0o644);
      response = await fetch(endpoint);
      assert.equal(response.status, 503);
      assert.equal(await response.text(), '');
    }
  });

  test(`${framework.name}: held source publication stays HTTP-readable without HMR navigation, then releases one fresh reload`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    await f.change('value.js', 'export const value = "changed";');
    assert.deepEqual(f.navigation(), [], 'a held accepted dependency must not update the document');
    await f.change('index.html', '<html><body>changed<script type="module" src="/main.js"></script></body></html>');
    assert.deepEqual(f.navigation(), [], 'a held HTML edit must not reload the document');
    f.publish(false);
    await eventually(() => f.navigation().length > 0, 'automatic release feedback');
    await delay(150);
    assert.deepEqual(f.navigation().map(message => message.type), ['full-reload'], 'discard partial HMR and release exactly one complete document reload');
    assert.match(await f.read('value.js'), /changed/);
    assert.match(await f.read('index.html'), /changed/);
    // Repeated ready writes are not held -> ready transitions.
    f.publish(false);
    await delay(150);
    assert.equal(f.navigation().length, 1);
    f.messages.length = 0;
    await f.change('value.js', 'export const value = "changed again";');
    assert.equal(f.navigation()[0]?.type, 'update', 'ordinary nonbackend edits retain HMR after release');
  });

  test(`${framework.name}: every publication rereads a newly held state before any file-watch callback`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework, true, false);
    // Synchronous publication and real transport sends in one turn force the
    // read-before-send contract; a watch-event-only cache cannot pass this.
    f.publish(true);
    const hot: { send(payload: NavigationPayload): void } = 'environments' in f.server
      ? f.server.environments.client.hot
      : f.server.ws;
    hot.send({ type: 'update', updates: [{ type: 'js-update', path: '/value.js', acceptedPath: '/value.js', timestamp: Date.now() }] });
    hot.send({ type: 'prune', paths: ['/value.js'] });
    hot.send({ type: 'full-reload', path: '*' });
    await delay(150);
    assert.deepEqual(f.navigation(), [], 'no navigation-affecting message may race the hold publication');
    f.publish(false);
    await eventually(() => f.navigation().length > 0, 'release from the synchronous hold');
    assert.deepEqual(f.navigation().map(message => message.type), ['full-reload']);
  });

  test(`${framework.name}: zero-recipient release cannot replay stale reload on a later held HMR connection`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    const disconnected = new Promise<void>(resolve => {
      f.socket.addEventListener('close', () => resolve(), { once: true });
    });
    f.socket.close();
    await disconnected;
    await eventually(() => f.server.ws.clients.size === 0, 'all actual HMR recipients disconnected');
    f.publish(false);
    const ready = f.httpPing();
    await eventually(ready.fulfilled, 'real HTTP reconnect succeeds after zero-recipient release');

    f.publish(true);
    const held = f.httpPing();
    await delay(150);
    assert.equal(held.fulfilled(), false, 'the next replacement is actually held before reconnect');
    f.messages.length = 0;
    await f.connect();
    await delay(150);
    assert.deepEqual(f.navigation(), [], 'a new held document must not receive an earlier buffered reload');

    f.publish(false);
    await eventually(() => f.navigation().length > 0, 'fresh automatic reload for the now-connected document');
    await delay(150);
    assert.deepEqual(f.navigation().map(message => message.type), ['full-reload']);
  });

  test(`${framework.name}: held HTTP reconnect probes never fulfill, while normal HTML and modules remain available`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    const ping = f.httpPing();
    await f.read('index.html');
    await f.read('value.js');
    await delay(150);
    assert.equal(ping.fulfilled(), false, '503 is still a successful Vite 5 reconnect; keep the request pending');
    f.publish(false);
    await eventually(ping.fulfilled, 'held HTTP ping released only after readiness');
  });

  if (framework.major === 8) {
    test(`${framework.name}: held websocket reconnect probes never open, including transient open-then-close`, { timeout: 10000 }, async t => {
      const f = await fixture(t, framework);
      const held = f.websocketPing();
      await delay(150);
      assert.equal(held.opened(), false, 'reject before WebSocket upgrade, not after accepting the ping');
      f.publish(false);
      await eventually(() => f.navigation().length === 1, 'readiness release');
      const ready = f.websocketPing();
      await eventually(ready.opened, 'successful websocket reconnect after readiness');
    });
  }

  test(`${framework.name}: malformed or foreign state cannot release feedback or reconnect probes`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    for (const raw of [
      '{',
      JSON.stringify({ ...f.context, held: 'false' }),
      JSON.stringify({ ...f.context, schemaVersion: 2, held: false }),
      JSON.stringify({ ...f.context, workspaceID: '51e7a131-645e-4367-8200-a0b42d8bfb56', held: false }),
      JSON.stringify({ ...f.context, generation: 'foreign-generation', held: false }),
      JSON.stringify({ ...f.context, workspaceRoot: f.root, held: false }),
    ]) {
      f.publishRaw(raw);
      const ping = f.httpPing();
      const wsPing = framework.major === 8 ? f.websocketPing() : undefined;
      await delay(150);
      assert.deepEqual(f.navigation(), [], `must remain held for ${raw}`);
      assert.equal(ping.fulfilled(), false, `invalid state cannot fulfill HTTP reconnect: ${raw}`);
      assert.equal(wsPing?.opened() ?? false, false, `invalid state cannot open WS reconnect: ${raw}`);
      ping.request.destroy();
      wsPing?.socket.close();
    }
    f.publish(false);
    await eventually(() => f.navigation().length === 1, 'valid same-inode repair releases feedback');
  });

  for (const replacement of ['new inode', 'symlink', 'public permissions', 'missing file'] as const) {
    test(`${framework.name}: ${replacement} cannot impersonate a ready supervisor state`, { timeout: 10000 }, async t => {
      const f = await fixture(t, framework);
      if (replacement === 'public permissions') {
        f.publish(false);
        chmodSync(f.file, 0o644);
      } else {
        renameSync(f.file, `${f.file}.owned`);
        if (replacement !== 'missing file') {
          writeFileSync(`${f.file}.foreign`, JSON.stringify({ ...f.context, held: false }), { mode: 0o600 });
          if (replacement === 'symlink') symlinkSync(`${f.file}.foreign`, f.file);
          else renameSync(`${f.file}.foreign`, f.file);
        }
      }
      const ping = f.httpPing();
      const wsPing = framework.major === 8 ? f.websocketPing() : undefined;
      await f.change('value.js', 'export const value = "changed";');
      assert.deepEqual(f.navigation(), [], 'path replacement/private-file loss cannot release or send updates');
      assert.equal(ping.fulfilled(), false);
      assert.equal(wsPing?.opened() ?? false, false);
    });
  }

  test(`${framework.name}: a held gate preserves real syntax-error overlays`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    const changed = once(f.hotUpdates, 'change');
    // Plain .js bypasses Vite's TS/JSX transformer. Import analysis uses a
    // module lexer, not full expression validation: a missing initializer can
    // pass through. An unterminated import must fail that real lexer itself.
    writeFileSync(path.join(f.workspaceRoot, 'value.js'), 'import "./unterminated');
    await changed;
    const response = await fetch(`${f.server.resolvedUrls!.local[0]}value.js`);
    const body = await response.text();
    assert.equal(response.status, 500, JSON.stringify({
      url: response.url, contentType: response.headers.get('content-type'), body,
    }));
    assert.match(body, /Failed to parse source for import analysis/);
    await eventually(() => f.messages.some(message => message.type === 'error'), 'real transform-error overlay');
    assert.deepEqual(f.navigation(), []);
  });

  test(`${framework.name}: closing the owned server terminates held HTTP requests`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework);
    const ping = f.httpPing();
    await delay(150);
    assert.equal(ping.fulfilled(), false);
    // events.once rejects on the expected ECONNRESET before 'close'; here the
    // consumer-visible contract is termination without any fulfilled HTTP reply.
    const ended = new Promise<void>(resolve => { ping.request.once('close', resolve); });
    await f.server.close();
    await ended;
    assert.equal(ping.fulfilled(), false, 'server close must not count as successful reconnect');
  });

  test(`${framework.name}: absent managed environment leaves ordinary reconnect untouched`, { timeout: 10000 }, async t => {
    const f = await fixture(t, framework, false);
    const ping = f.httpPing();
    await eventually(ping.fulfilled, 'ordinary HTTP reconnect');
    if (framework.major === 8) {
      const wsPing = f.websocketPing();
      await eventually(wsPing.opened, 'ordinary websocket reconnect');
    }
  });
}
