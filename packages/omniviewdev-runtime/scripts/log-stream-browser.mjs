/**
 * Runs the log stream (`src/logStream.ts`) in WebKit and Chromium over the REAL Wails runtime, against a small HTTP server that answers the runtime's
 * calls as the Go host does, and prints what it costs there. The unit tests replace the runtime with a transport they drive; this does not: the call
 * leaves through the runtime's own fetch transport, and a line arrives through the runtime's own `dispatchWailsEvent`, the function the page's WebSocket
 * (server mode) or the webview (native) calls for every event Go emits.
 *
 *   node packages/omniviewdev-runtime/scripts/log-stream-browser.mjs        needs Playwright's browsers; no host, no Go
 *
 * It asserts what the stream sends (`CreateSession` and `CloseSession`), what it does with the answer (a session whose `active_sources` is JSON null,
 * as Go writes a session that has none yet) and that nothing is delivered after `close()`; then it times 20,000 batches of 100 lines, the host's batch:
 * one JSON string, each line carrying its labels. The batches are built before the clock starts.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];

const bundle = await build({
  stdin: {
    contents: `export { openLogStream } from './src/logStream.ts'; export { Events } from '@wailsio/runtime';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'harness',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const script = bundle.outputFiles[0].text;

/** Notes a call as it arrives, so that the order the page made them in is the order of `calls`. */
function record(request) {
  if (request.object === 10) {
    calls.push({ cancel: request.args['call-id'] });
  } else if (request.object === 0) {
    const { methodName, methodID, args } = request.args;
    calls.push({ methodName, methodID, args });
  }
}

/** The Go host's answer to a call: a `LogSession` as `json.Marshal` writes it. */
function answer(request) {
  if (request.object === 0 && request.args.methodName?.endsWith('.CreateSession')) {
    const sent = JSON.parse(request.args.args[2]);
    return {
      id: sent.session_id, plugin_id: '', connection_id: '', resource_key: sent.resource_key, resource_id: sent.resource_id,
      options: sent.options, status: 4, active_sources: null, created_at: '2026-11-19T10:00:00Z',
    };
  }
  return null;
}
/** The create call of the resource named `slow` is answered after this long: long enough for the page to close the stream while the call is out. */
const SLOW_MS = 400;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/wails/runtime') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const request = JSON.parse(text);
      record(request);
      const slow = request.object === 0 && request.args.methodName?.endsWith('.CreateSession') && JSON.parse(request.args.args[2]).resource_id === 'slow';
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(answer(request)));
      }, slow ? SLOW_MS : 0);
    });
    return;
  }
  if (req.url === '/harness.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(script);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>log stream</title><script src="/harness.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;

/** Runs in the page, in the engine under test. */
async function inPage() {
  const LABELS = { pod: 'checkout-7c9d8b5f6-x2x9k', container: 'app', namespace: 'production', node: 'ip-10-0-12-34.ec2.internal' };
  const TEXTS = [
    '{"level":"info","ts":"2026-11-19T10:15:30.123Z","msg":"request completed","method":"GET","path":"/api/v1/cart","status":200,"duration_ms":12}',
    '2026-11-19T10:15:30.456Z INFO  [checkout] order 8f3a91 accepted for customer 55120 (3 items, total 124.90 EUR)',
    'E1119 10:15:30.789012       1 reflector.go:138] failed to watch *v1.Pod: the server could not find the requested resource',
    '\u001b[32mGET\u001b[0m /healthz 200 0.4ms',
  ];
  const wireBatch = (from) => JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
    session_id: 's', source_id: `${LABELS.pod}/${LABELS.container}`, labels: LABELS,
    timestamp: `2026-11-19T10:15:${String((from + index) % 60).padStart(2, '0')}.${String(from + index).padStart(9, '0')}Z`,
    content: TEXTS[(from + index) % TEXTS.length], origin: 0, level: 0,
  })));
  const pool = Array.from({ length: 256 }, (_, index) => wireBatch(index * 100));
  const dispatch = (name, data) => window._wails.dispatchWailsEvent({ name, data });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const open = async () => {
    const stream = harness.openLogStream({ plugin: 'kubernetes', connection: 'conn-1', resourceKey: 'k8s:/pods', resourceId: 'checkout', target: 'app', params: { filter_labels: 'container' } });
    await sleep(100);
    return stream;
  };
  const BATCHES = 20000;
  const micros = (ms) => Math.round((ms / BATCHES) * 10000) / 10;
  const timed = (run) => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };
  const out = {};

  // The contract, over the real runtime.
  const stream = await open();
  out.id = stream.id;
  out.stateAfterCreate = stream.getSnapshot().state;
  dispatch(`core/logs/event/${stream.id}`, JSON.stringify({ type: 6, source_id: '', message: 'All sources connected', timestamp: '2026-11-19T10:00:00Z' }));
  out.stateAfterReady = stream.getSnapshot().state;
  dispatch(`core/logs/lines/${stream.id}`, pool[0]);
  out.firstLine = stream.read(1).lines[0];
  await sleep(80);
  out.sources = stream.getSnapshot().sources;
  await stream.close();
  dispatch(`core/logs/lines/${stream.id}`, pool[1]);
  out.receivedAfterClose = stream.stats().received;
  out.stateAfterClose = stream.getSnapshot().state;

  // Closed while the create call is still out: the call is cancelled, the session is closed after it, and the late answer changes nothing.
  const slow = harness.openLogStream({ plugin: 'kubernetes', connection: 'conn-1', resourceKey: 'k8s:/pods', resourceId: 'slow' });
  out.slowId = slow.id;
  await sleep(50);
  await slow.close();
  await sleep(600);
  out.slowState = slow.getSnapshot().state;
  out.slowSources = slow.getSnapshot().sources.length;
  // The floor: the runtime's dispatch to a listener that parses the batch and does nothing else. It and the stream, read a frame (five batches) at a time, are both
  // warm before anything is timed, and are timed over five rounds that alternate which of the two goes first; the medians are reported, with every round.
  const floorName = `core/logs/lines/floor-${String(Math.random())}`;
  const off = harness.Events.On(floorName, (event) => JSON.parse(event.data));
  const framed = await open();
  const dispatchBatches = (name, frames) => {
    for (let index = 0; index < BATCHES; index++) {
      dispatch(name, pool[index % pool.length]);
      if (frames && index % 5 === 4) {
        framed.read(500);
      }
    }
  };
  const runFloor = () => timed(() => dispatchBatches(floorName, false));
  const runFramed = () => timed(() => dispatchBatches(`core/logs/lines/${framed.id}`, true));
  runFloor();
  runFramed();
  const rounds = [];
  for (let round = 0; round < 5; round++) {
    const floorFirst = round % 2 === 0;
    const first = floorFirst ? runFloor() : runFramed();
    const second = floorFirst ? runFramed() : runFloor();
    rounds.push({ order: floorFirst ? 'floor first' : 'stream first', floor: floorFirst ? first : second, stream: floorFirst ? second : first });
  }
  off();
  const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const framedMs = median(rounds.map((round) => round.stream));
  out.floorMicrosPerBatch = micros(median(rounds.map((round) => round.floor)));
  out.framedLinesPerSecond = Math.round((BATCHES * 100) / (framedMs / 1000));
  out.framedMicrosPerBatch = micros(framedMs);
  out.framedRounds = rounds.map((round) => `${round.order}: floor ${String(micros(round.floor))}, stream ${String(micros(round.stream))}`).join(' | ');
  out.framedStats = framed.stats();
  await framed.close();

  // The stream, never read: at the bound, dropping.
  const unread = await open();
  for (let index = 0; index < 2000; index++) {
    dispatch(`core/logs/lines/${unread.id}`, pool[index % pool.length]);
  }
  const unreadMs = timed(() => {
    for (let index = 0; index < BATCHES; index++) {
      dispatch(`core/logs/lines/${unread.id}`, pool[index % pool.length]);
    }
  });
  out.unreadLinesPerSecond = Math.round((BATCHES * 100) / (unreadMs / 1000));
  out.unreadMicrosPerBatch = micros(unreadMs);
  out.unreadStats = unread.stats();
  out.drainOfFullBufferMs = Math.round(timed(() => unread.read(100000)) * 100) / 100;
  await unread.close();
  return out;
}

let failures = 0;
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    calls.length = 0;
    await page.goto(origin);
    const result = await page.evaluate(`(${inPage.toString()})()`);

    // What went to Go.
    const create = calls.find((call) => call.methodName?.endsWith('.CreateSession'));
    assert.ok(create, 'CreateSession was called');
    assert.equal(create.methodName, 'github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession');
    assert.deepEqual(create.args.slice(0, 2), ['kubernetes', 'conn-1']);
    const sent = JSON.parse(create.args[2]);
    assert.equal(sent.session_id, result.id);
    assert.deepEqual(sent.options, {
      target: 'app', follow: true, include_previous: false, include_timestamps: true, tail_lines: 1000, since_seconds: 0, limit_bytes: 0,
      include_source_events: true, params: { filter_labels: 'container' },
    });
    const closes = calls.filter((call) => call.methodID !== undefined && call.args[0] === result.id);
    assert.equal(closes.length, 1, 'the session was closed once');

    // What the stream made of the answer and the events.
    assert.equal(result.stateAfterCreate, 'starting');
    assert.equal(result.stateAfterReady, 'streaming');
    assert.equal(result.firstLine.seq, 1);
    assert.equal(result.firstLine.source, 'checkout-7c9d8b5f6-x2x9k/app');
    assert.equal(result.firstLine.origin, 'current');
    assert.equal(result.sources.length, 1);
    assert.deepEqual(result.sources[0].labels, LABELS_OF_THE_BATCH());
    assert.equal(result.stateAfterClose, 'ended');
    assert.equal(result.receivedAfterClose, 100, 'one batch arrived, and nothing after close()');
    assert.equal(result.framedStats.received, 6 * 20000 * 100, 'one warm-up and five rounds of 20,000 batches of 100 lines');
    assert.equal(result.framedStats.dropped, 0);
    assert.equal(result.unreadStats.held, 100000);
    assert.equal(result.unreadStats.dropped, result.unreadStats.received - 100000);
    // Closed while the create call was out: it created, then was cancelled, then the session was closed, in that order, and the late answer changed nothing.
    const order = calls.flatMap((call, index) => {
      if (call.cancel !== undefined) {
        return [`${String(index)}:cancel`];
      }
      if (call.methodName?.endsWith('.CreateSession') && JSON.parse(call.args[2]).resource_id === 'slow') {
        return [`${String(index)}:create`];
      }
      return call.methodID !== undefined && call.args[0] === result.slowId ? [`${String(index)}:close`] : [];
    });
    assert.deepEqual(order.map((entry) => entry.split(':')[1]), ['create', 'cancel', 'close'], 'create, cancel, close');
    assert.equal(result.slowState, 'ended');
    assert.equal(result.slowSources, 0);
    assert.deepEqual(errors, [], 'no error in the page');

    console.log(`PASS ${name} ${browser.version()}`);
    const { id, firstLine, sources, ...cost } = result;
    void id; void firstLine; void sources;
    console.log(JSON.stringify(cost));
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}:`, error);
  } finally {
    await browser.close();
  }
}
server.close();
process.exit(failures === 0 ? 0 : 1);

function LABELS_OF_THE_BATCH() {
  return { pod: 'checkout-7c9d8b5f6-x2x9k', container: 'app', namespace: 'production', node: 'ip-10-0-12-34.ec2.internal' };
}
