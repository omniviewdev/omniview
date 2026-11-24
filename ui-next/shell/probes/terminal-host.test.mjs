// Tests of the probe's far end (terminal-host.mjs): the T2-go host as the document states it, driven by a page that follows its protocol (2.4). `node --test ui-next/shell/probes/terminal-host.test.mjs`. The probe's assertions
// are only as good as the host they run against, so what the host promises is checked here first: contiguous offsets, a ring that moves, modes that are exact at the start of a replay, a join with no gap and no duplicate
// whatever the host delivers late, the attachment numbers, the lease, the held reader, the input numbers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHost, LIMITS, READ_MAX, Ring, Scanner } from './terminal-host.mjs';

const KEY = 'k'.repeat(32);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (text) => Buffer.from(text).toString('base64');

/** A window as the host sees it: what it is sent is kept in order, and a call is made as its page would make it. */
function windowOf(host, id) {
  const events = [];
  const listeners = [];
  host.register(id, (name, data) => {
    events.push({ name, data });
    for (const listener of listeners) listener(name, data);
  });
  return {
    id,
    events,
    on: (listener) => listeners.push(listener),
    call: async (method, ...args) => host.call(id, method, args),
    create: async (terminal, launch = { cols: 80, rows: 24, page_key: KEY }) => host.call(id, 'CreateTerminal', [{ id: terminal }, launch]),
    type: async (terminal, seq, text) => host.call(id, 'WriteTerminal', [terminal, seq, b64(text)]),
    outputOf: (terminal) => events.filter((event) => event.name === `core/exec/stream/output/${terminal}`).map((event) => event.data),
    signals: (name, terminal) => events.filter((event) => event.name === `core/exec/signal/${name}/${terminal}`).map((event) => event.data),
  };
}

/** The page of T2-go 2.4: it keeps the bytes it applied, holds events while a call is in flight, drops what it has by offset, and acknowledges only what it took from events. */
async function pageThatJoins(window, terminal, { held = [] } = {}) {
  const page = { applied: [], next: 0, acked: 0, dropped: 0, replay: undefined, attachment: undefined };
  let calling = true;
  const heldEvents = [...held];
  const apply = (event) => {
    const bytes = Buffer.from(event.data, 'base64');
    if (event.offset + bytes.length <= page.next) {
      page.dropped += 1;
      return;
    }

    assert.equal(event.offset, page.next, `an event at ${String(event.offset)} where ${String(page.next)} was expected: a gap`);
    page.applied.push(bytes);
    page.next += bytes.length;
    void window.call('AckTerminal', terminal, bytes.length).then(() => undefined);
    page.acked += bytes.length;
  };

  window.on((name, data) => {
    if (name !== `core/exec/stream/output/${terminal}`) return;
    if (calling) heldEvents.push(data);
    else apply(data);
  });
  const answer = await window.call('AttachTerminal', terminal, { page_key: KEY });
  page.replay = answer.replay;
  page.attachment = answer.attachment;
  page.answer = answer;
  page.applied.push(Buffer.from(answer.replay.data, 'base64'));
  page.next = answer.replay.end;
  calling = false;
  for (const event of heldEvents.splice(0)) apply(event);
  return page;
}

const linesOf = (buffers) =>
  Buffer.concat(buffers)
    .toString()
    .split('\r\n')
    .filter((line) => /^\d{7} x/.test(line))
    .map((line) => Number(line.slice(0, 7)));

test('a keyed terminal sends output events with contiguous offsets of at most one read, an unkeyed one sends stdout, and the end says how many bytes were written', async () => {
  const host = createHost();
  const page = windowOf(host, 'w1');
  await page.create('keyed');
  await page.create('plain', { cols: 80, rows: 24 });
  host.flood('keyed', 300, 80);
  host.append('plain', 'hello');
  await sleep(300);
  const events = page.outputOf('keyed');
  let at = 0;
  for (const event of events) {
    assert.equal(event.offset, at);
    const length = Buffer.from(event.data, 'base64').length;
    assert.ok(length <= READ_MAX);
    at += length;
  }

  assert.ok(events.length > 1);
  assert.ok(page.events.some((event) => event.name === 'core/exec/stream/stdout/plain' && typeof event.data === 'string'));
  host.end('keyed', { reason: 'exited', exit_code: 3 });
  await sleep(20);
  assert.deepEqual(page.signals('CLOSE', 'keyed').at(-1), { reason: 'exited', exit_code: 3, last_offset: at });
  host.stop();
});

test('a page key must be 16 to 128 visible ASCII characters, and a lease needs one', async () => {
  const host = createHost();
  const page = windowOf(host, 'w1');
  for (const bad of ['short', 'has a space in it, a long one', 'é'.repeat(20), 'k'.repeat(129)]) {
    await assert.rejects(page.create('t', { page_key: bad }), (error) => JSON.parse(error.message).code === 'INVALID_REQUEST' && /page_key/.test(JSON.parse(error.message).detail));
  }

  await assert.rejects(page.create('t', { lease_ms: 1000 }), (error) => /lease_ms/.test(JSON.parse(error.message).detail));
  await assert.rejects(page.create('t', { page_key: KEY, lease_ms: LIMITS.lease_max_ms + 1 }), (error) => /lease_ms/.test(JSON.parse(error.message).detail));
  assert.equal((await page.create('t', { page_key: KEY, lease_ms: 5000 })).lease_ms, 5000);
  host.stop();
});

test('a reload under a flood joins with no gap and no duplicate, acknowledging only what the live events gave, with an event the replay holds delivered late', async () => {
  for (const duplicates of ['late', 'early']) {
    const host = createHost({ duplicates, leaseMs: 60_000 });
    const first = windowOf(host, 'w1');
    await first.create('t');
    first.on((name, data) => {
      if (name === 'core/exec/stream/output/t') void first.call('AckTerminal', 't', Buffer.from(data.data, 'base64').length);
    });
    await first.call('AckTerminal', 't', 0);
    host.flood('t', 60_000, 80);
    while ((host.state('t')?.end ?? 0) < 2_500_000) await sleep(5);
    // The page goes away: its terminal is detached, and the host reads nothing more.
    host.retire('w1');
    await sleep(20);
    const held = host.state('t');
    assert.equal(held.holder, null);
    await sleep(60);
    assert.equal(host.state('t').end, held.end, 'a detached terminal is not read');
    const second = windowOf(host, 'w2');
    assert.deepEqual((await second.call('ListTerminals', KEY)).map((item) => item.id), ['t']);
    const joined = await pageThatJoins(second, 't');
    assert.equal(joined.attachment, 1);
    assert.ok(joined.replay.start > 0, 'the ring moved');
    assert.ok(joined.replay.end - joined.replay.start <= LIMITS.replay_bytes + 100_000);
    while (host.state('t').waiting > 0 || host.state('t').paused || host.state('t').end < 60_000 * 82) await sleep(10);
    await sleep(40);
    const numbers = linesOf(joined.applied);
    assert.ok(numbers.length > 10_000);
    assert.deepEqual(
      numbers,
      numbers.map((_, index) => numbers[0] + index),
      'consecutive lines',
    );
    assert.equal(numbers.at(-1), 59_999);
    assert.equal(joined.acked, host.state('t').end - joined.replay.end, 'the live bytes, and no replay');
    if (duplicates === 'late') assert.ok(joined.dropped >= 1, 'the late event was dropped by its offset');
    host.stop();
  }
});

test('the modes are exact at the start of a replay, also after the bytes that set them fell out of the ring', async () => {
  const host = createHost({ leaseMs: 60_000 });
  const first = windowOf(host, 'w1');
  await first.create('t');
  first.on((name, data) => {
    if (name === 'core/exec/stream/output/t') void first.call('AckTerminal', 't', Buffer.from(data.data, 'base64').length);
  });
  await first.call('AckTerminal', 't', 0);
  host.append('t', '\u001b[?1049h\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?1h\u001b[?1004h\u001b[?25l');
  host.flood('t', 40_000, 80);
  while ((host.state('t')?.end ?? 0) < 3_000_000) await sleep(5);
  host.retire('w1');
  const second = windowOf(host, 'w2');
  const { replay } = await second.call('AttachTerminal', 't', { page_key: KEY });
  assert.ok(replay.start > 1000, 'the ring no longer holds the bytes that set the modes');
  for (const modes of [replay.start_modes, replay.modes]) {
    assert.deepEqual({ ...modes }, { known: true, alt_screen: true, bracketed_paste: true, application_cursor: true, focus_events: true, cursor_hidden: true, mouse_tracking: 1, mouse_encoding: 2, kitty_keyboard: [] });
  }

  host.stop();
});

test('the modes are the same however the output is cut, and a ring answers them at every offset', () => {
  const text = Buffer.from('ab\u001b[?1049h\u001b[?25lé\u001b]0;title\u0007\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?1049lcd\u001b[?25h\u001b[?1002h\u001b[?1003h\u001b[?1000l');
  const whole = new Scanner();
  whole.feed(text);
  assert.deepEqual(whole.modes, { known: true, alt_screen: false, bracketed_paste: true, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 6, mouse_encoding: 2, kitty_keyboard: [] });
  for (let cut = 0; cut <= text.length; cut += 1) {
    const parts = new Scanner();
    parts.feed(text.subarray(0, cut));
    parts.feed(text.subarray(cut));
    assert.deepEqual(parts.modes, whole.modes, `cut at ${String(cut)}`);
  }

  // A ring of many small reads answers the modes at every offset as a scanner that read up to it does, across its chunks.
  const ring = new Ring(80, 24);
  const big = Buffer.concat([text, Buffer.alloc(70_000, 'x'), text, Buffer.alloc(70_000, 'y')]);
  for (let at = 0; at < big.length; at += 777) ring.record(big.subarray(at, Math.min(big.length, at + 777)));
  assert.ok(ring.chunks.length >= 2);
  for (const offset of [0, 1, 5, 40, text.length, text.length + 100, 70_000, 70_100, ring.chunks[1].start, ring.chunks[1].start + 3, big.length - 1, big.length]) {
    const expected = new Scanner();
    expected.feed(big.subarray(0, offset));
    assert.deepEqual(ring.modesAt(offset), expected.modes, `at offset ${String(offset)}`);
  }
});

test('the page that took the terminal over is the owner: the one that lost it is told with its own number, cannot detach it, and a late retirement finds nothing', async () => {
  const host = createHost({ leaseMs: 60_000 });
  const a = windowOf(host, 'a');
  await a.create('t');
  const b = windowOf(host, 'b');
  const answer = await b.call('AttachTerminal', 't', { page_key: KEY });
  assert.equal(answer.attachment, 1);
  assert.deepEqual(a.signals('DETACHED', 't'), [{ by: 'taken-over', attachment: 0 }]);
  await assert.rejects(a.call('DetachTerminal', 't', { page_key: KEY }), (error) => JSON.parse(error.message).code === 'NOT_FOUND');
  host.retire('a');
  assert.equal(host.state('t').holder, 1, 'the late retirement of the old page leaves what the new page holds');
  assert.equal(a.signals('DETACHED', 't').length, 1);
  await assert.rejects(windowOf(host, 'c').call('AttachTerminal', 't', { page_key: 'x'.repeat(32) }), (error) => JSON.parse(error.message).code === 'NOT_FOUND');
  host.stop();
});

test('a lease that runs out ends the terminal with one CLOSE detach-timeout, and the owner that detaches is told requested', async () => {
  const host = createHost({ leaseMs: 80 });
  const a = windowOf(host, 'a');
  await a.create('t');
  const detached = await a.call('DetachTerminal', 't', {});
  assert.ok(detached.lease_expires_unix_ms > Date.now() - 5);
  assert.deepEqual(a.signals('DETACHED', 't'), [{ by: 'requested', attachment: 0 }]);
  await sleep(160);
  const closes = a.signals('CLOSE', 't');
  assert.equal(closes.length, 1);
  assert.deepEqual({ reason: closes[0].reason, closed_by: closes[0].closed_by }, { reason: 'closed', closed_by: 'detach-timeout' });
  assert.equal(host.state('t'), undefined);
  host.stop();
});

test('a shell that ends is kept as a tombstone, whether or not a page holds it: the CLOSE goes to every window, a page attaches to it and the attachment does not advance, and the real host does not dismiss it', async () => {
  for (const attached of [false, true]) {
    const host = createHost({ leaseMs: 60_000 });
    const a = windowOf(host, 'a');
    const observer = windowOf(host, 'observer');
    await a.create('t');
    host.append('t', 'last words\r\n');
    if (!attached) host.retire('a');
    host.end('t', { reason: 'exited', exit_code: 7 });
    await sleep(20);
    const closes = observer.signals('CLOSE', 't');
    assert.equal(closes.length, 1, 'the end is told to every window');
    assert.equal(closes[0].exit_code, 7);
    const b = windowOf(host, 'b');
    const listed = await b.call('ListTerminals', KEY);
    assert.equal(listed[0].ended.exit_code, 7);
    assert.equal(listed[0].attached, false);
    const answer = await b.call('AttachTerminal', 't', { page_key: KEY });
    assert.equal(answer.ended.last_offset, answer.replay.end);
    assert.equal(answer.attachment, 0, 'the attachment number does not advance');
    assert.deepEqual(answer.busy, { state: 'unknown', reason: 'ended' });
    assert.match(Buffer.from(answer.replay.data, 'base64').toString(), /last words/);
    await assert.rejects(b.call('CloseSession', 't'), (error) => JSON.parse(error.message).code === 'NOT_FOUND');
    assert.equal((await b.call('ListTerminals', KEY)).length, 1, 'the tombstone stays until its lease is over');
    host.stop();
  }

  const dismissing = createHost({ leaseMs: 60_000, tombstoneClose: 'dismiss' });
  const c = windowOf(dismissing, 'c');
  await c.create('t');
  dismissing.end('t');
  await c.call('CloseSession', 't');
  assert.deepEqual(await c.call('ListTerminals', KEY), []);
  await assert.rejects(c.create('u', { page_key: KEY }).then(async () => c.create('u', { page_key: KEY })), (error) => JSON.parse(error.message).code === 'ALREADY_EXISTS');
  dismissing.stop();
});

test('the host expects the next input number across an attach and always says it, in the answer of the attach and in the list: 1 or more on a terminal that runs, 0 on one that ended; a write between the list and the attach makes the list stale', async () => {
  const host = createHost({ leaseMs: 60_000, writeBetween: true });
  const a = windowOf(host, 'a');
  await a.create('t');
  for (let seq = 1; seq <= 4; seq += 1) await a.type('t', seq, 'x');
  host.retire('a');
  const b = windowOf(host, 'b');
  const listed = await b.call('ListTerminals', KEY);
  assert.equal(listed[0].next_input_seq, 5, 'the list says what the queue takes next when it is made');
  const answer = await b.call('AttachTerminal', 't', { page_key: KEY });
  assert.equal(answer.next_input_seq, 6, 'a write of another tab took 5 meanwhile: the answer says the number now');
  await assert.rejects(b.type('t', 5, 'y'), (error) => JSON.parse(error.message).code === 'SEQUENCE_STALE');
  await assert.rejects(b.type('t', 1, 'y'), (error) => JSON.parse(error.message).code === 'SEQUENCE_STALE');
  await b.type('t', 6, 'y');
  await b.type('t', 0, 'z');
  assert.equal(host.state('t').next, 7, 'a call numbered 0 is applied as it comes and does not move the number');
  assert.deepEqual(
    host.log.calls.filter((entry) => entry.method === 'WriteTerminal').map((entry) => [entry.window, entry.seq, entry.outcome]),
    [['a', 1, 'applied'], ['a', 2, 'applied'], ['a', 3, 'applied'], ['a', 4, 'applied'], ['other-tab', 5, 'applied'], ['b', 5, 'stale'], ['b', 1, 'stale'], ['b', 6, 'applied'], ['b', 0, 'applied']],
  );
  assert.deepEqual(host.log.lists.map((entry) => entry.listed), [[{ id: 't', next_input_seq: 5 }]]);
  assert.equal(host.log.attaches.at(-1).next_input_seq, 6);
  host.end('t');
  await sleep(20);
  const c = windowOf(host, 'c');
  assert.equal((await c.call('ListTerminals', KEY))[0].next_input_seq, 0, 'a terminal that ended is listed with 0');
  assert.equal((await c.call('AttachTerminal', 't', { page_key: KEY })).next_input_seq, 0, 'and attached with 0');
  host.stop();

  // Without `writeBetween` the list and the attach say the same number; a terminal that has taken no input says 1.
  const plain = createHost({ leaseMs: 60_000 });
  const d = windowOf(plain, 'd');
  await d.create('t');
  plain.retire('d');
  const e = windowOf(plain, 'e');
  assert.equal((await e.call('ListTerminals', KEY))[0].next_input_seq, 1);
  assert.equal((await e.call('AttachTerminal', 't', { page_key: KEY })).next_input_seq, 1);
  plain.stop();
});

test('a terminal with no key ends with its window, and its own window is told it cannot be attached', async () => {
  const host = createHost();
  const a = windowOf(host, 'a');
  await a.create('plain', { cols: 80, rows: 24 });
  await assert.rejects(a.call('AttachTerminal', 'plain', {}), (error) => JSON.parse(error.message).code === 'NOT_REATTACHABLE');
  await assert.rejects(windowOf(host, 'b').call('AttachTerminal', 'plain', {}), (error) => JSON.parse(error.message).code === 'NOT_FOUND');
  const observer = windowOf(host, 'b');
  host.retire('a');
  await sleep(10);
  assert.deepEqual(observer.signals('CLOSE', 'plain').map((end) => end.closed_by), ['window']);
  host.stop();
});

test('the answer of an attach can be held: the host has taken the terminal over and told the page that held it, the answer comes when it is let go, and the hold is for one call', async () => {
  const host = createHost({ leaseMs: 60_000 });
  const a = windowOf(host, 'a');
  await a.create('t');
  const b = windowOf(host, 'b');
  const hold = host.holdAttach('t');
  let answered = false;
  const pending = b.call('AttachTerminal', 't', { page_key: KEY }).then((answer) => {
    answered = true;
    return answer;
  });
  await sleep(30);
  assert.equal(hold.held(), true, 'the call has arrived and its answer is held');
  assert.equal(answered, false, 'the answer waits');
  assert.equal(host.state('t').holder, 1, 'the terminal is taken over meanwhile');
  assert.deepEqual(a.signals('DETACHED', 't'), [{ by: 'taken-over', attachment: 0 }], 'and the page that held it is told, with its own number');
  hold.release();
  const answer = await pending;
  assert.equal(answer.attachment, 1);
  assert.equal(hold.held(), false);
  const c = windowOf(host, 'c');
  assert.equal((await c.call('AttachTerminal', 't', { page_key: KEY })).attachment, 2, 'the next attach is answered as it comes');
  host.stop();
});
