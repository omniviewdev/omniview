// Tests of the probe's far end (terminal-host.mjs): the host of the terminal channel as docs/ui-next/terminal-channel-protocol.md states it, driven by a page that follows the protocol. `node --test ui-next/shell/probes/terminal-host.test.mjs`.
// The probe's assertions are only as good as the host they run against, so what the host promises is checked here first: a capability that opens a terminal and nothing else, frames that are byte for byte the document's, a replay that starts
// exactly where the page asked, contiguous offsets, a ring that moves and says what it lost, modes that are exact at the start of a replay, a window of acknowledgements that is never passed, the holder that is the stream, a lease, a kept end.
// Nothing here waits for a time: a test waits for the frame, the close or the log line it asserts (`until`), and the leases are timers of a few milliseconds that the test waits for by their effect. A test that waits for something that never
// comes ends at the runner's own deadline, with the name of what it was waiting for.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHost, FRAME, KEPT_ENDS, KNOWN, LIMITS, pageFrames, readFrame, Ring, Scanner, URLS } from './terminal-host.mjs';

const text = new TextDecoder();
const CAP = /^[A-Za-z0-9_-]{43}$/;
const MODES_ON = { known: true, alt_screen: true, bracketed_paste: true, application_cursor: true, focus_events: true, cursor_hidden: true, mouse_tracking: 1, mouse_encoding: 2, kitty_keyboard: [] };
const timeout = { timeout: 30_000 };

/** Makes a terminal and answers it with its capability. */
const make = async (host, id = 't', launch = { channel: true, cols: 80, rows: 24 }) => {
  const made = await host.call('CreateTerminal', [{ id }, launch]);
  // The shell's banner is written a task after it starts: what a test counts of its own starts after it.
  while (host.state(id) !== undefined && host.state(id).end === 0) await new Promise((resolve) => setImmediate(resolve));
  return made;
};

/**
 * A page that follows the protocol: it opens a stream, sends `attach` (with `from` when it has the bytes before it), keeps every frame the host sends in order, applies the output by offset (a frame that does not join is a failure
 * of the host, and the test says so), acknowledges what it took when `ack` is on (the first acknowledgement, of nothing, turns the host's window on), and says when the stream is closed.
 */
function pageOf(host, cap, { from, ack = true, sendAttach = true, join = true } = {}) {
  const page = { frames: [], closed: false, ready: undefined, applied: [], raw: [], next: undefined, end: undefined, ended: undefined, gaps: [], taken: false, notFound: false, waiters: [], acked: 0, live: 0 };
  const wake = () => {
    for (const waiter of page.waiters.splice(0)) waiter();
  };

  page.stream = host.openStream(
    (frame) => {
      const read = readFrame(frame);
      page.raw.push(frame);
      page.frames.push(read);
      if (read.kind === 'ready') {
        page.ready = read.ready;
        page.next = read.ready.start;
        page.end = read.ready.end;
        if (ack) page.stream.send(pageFrames.ack(0));
      } else if (read.kind === 'output') {
        if (join) assert.equal(read.offset, page.next, `a frame at ${String(read.offset)} where ${String(page.next)} was expected: no gap and no byte twice`);
        assert.ok(read.bytes.length <= LIMITS.channel_frame_bytes, 'a frame is at most 64 KiB');
        page.applied.push(read.bytes);
        page.next += read.bytes.length;
        if (read.offset >= page.end) page.live += read.bytes.length;
        // The page acknowledges every byte of output it took, the replay included, and never a gap: the host counts every frame it sent against its window.
        if (ack) {
          page.acked += read.bytes.length;
          page.stream.send(pageFrames.ack(read.bytes.length));
        }
      } else if (read.kind === 'gap') {
        assert.equal(read.from, page.next);
        page.gaps.push(read);
        page.next = read.to;
        // A gap that crosses the end of the replay ends it: what follows is live.
        if (read.to >= page.end) page.end = 0;
      } else if (read.kind === 'ended') {
        page.ended = read.end;
      } else if (read.kind === 'taken-over') {
        page.taken = true;
      } else if (read.kind === 'not-found') {
        page.notFound = true;
      }

      wake();
    },
    () => {
      page.closed = true;
      wake();
    },
  );
  page.until = async (name, done) => {
    while (!done()) await new Promise((resolve) => page.waiters.push(resolve));
    return name;
  };

  page.bytes = () => Buffer.concat(page.applied);
  if (sendAttach) page.stream.send(pageFrames.attach(cap, from));
  return page;
}

const numbersOf = (buffer) => [...buffer.toString('latin1').matchAll(/(\d{7}) x/g)].map((found) => Number(found[1]));

/** Waits for what the host does by itself (a lease, a flood) by its effect: `done` is looked at again after every macrotask, and the wait ends with the name of what never came when its deadline is over (a stalled host does not keep the process alive). */
const until = async (done, what = 'the condition', ms = 20_000) => {
  const stop = Date.now() + ms;
  while (!done()) {
    if (Date.now() > stop) throw new Error(`gave up waiting for ${what} after ${String(ms)} ms`);
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('a capability is answered once, opens a terminal and nothing else, and every call that names one that opens nothing answers the one error', timeout, async () => {
  const host = createHost();
  const first = await make(host, 'a');
  const second = await make(host, 'b');
  assert.match(first.cap, CAP);
  assert.notEqual(first.cap, second.cap);
  assert.equal(first.id, 'a');
  // The id is a label: it opens nothing, and a capability that is wrong by a byte opens nothing.
  const wrong = `${first.cap.slice(0, 42)}${first.cap.endsWith('A') ? 'B' : 'A'}`;
  const nothing = [undefined, '', 'a', 'short', wrong, `${first.cap}x`, 42, null];
  const words = new Set();
  for (const cap of nothing) {
    for (const method of ['CloseChannelTerminal', 'ChannelTerminalBusy', 'ChannelTerminalCwd', 'DismissChannelTerminal']) {
      await assert.rejects(host.call(method, [cap]), (error) => {
        const envelope = JSON.parse(error.message);
        assert.equal(envelope.type, 'omniview:session/not-found');
        assert.equal(envelope.status, 404);
        words.add(error.message);
        return String(cap).length < 43 || !error.message.includes(String(cap));
      });
    }
  }

  assert.equal(words.size, 1, 'whatever the reason it opens nothing, the answer is the same words');
  // The list answers in the order the capabilities were given, naming each terminal by its id, and nothing for one that opens nothing.
  const listed = await host.call('ListChannelTerminals', [[second.cap, wrong, first.cap]]);
  assert.deepEqual(
    listed.map((entry) => entry.id),
    ['b', 'a'],
  );
  assert.equal(listed[0].attached, false);
  assert.equal(JSON.stringify(listed).includes(first.cap), false, 'a list never says a capability');
  await assert.rejects(host.call('ListChannelTerminals', [new Array(1025).fill(first.cap)]), (error) => JSON.parse(error.message).code === 'INVALID_REQUEST');
  // A call is logged with what it was and what became of it, and never with a capability.
  assert.equal(JSON.stringify(host.log.calls).includes(first.cap), false);
  // A terminal is made with launch.channel, and a lease is 0 to thirty minutes.
  await assert.rejects(host.call('CreateTerminal', [{ id: 'x' }, { cols: 80, rows: 24 }]), (error) => JSON.parse(error.message).code === 'INVALID_REQUEST');
  await assert.rejects(host.call('CreateTerminal', [{ id: 'x' }, { channel: true, cols: 80, rows: 24, lease_ms: LIMITS.lease_max_ms + 1 }]), (error) => /lease_ms/.test(JSON.parse(error.message).detail));
  assert.equal((await make(host, 'y', { channel: true, cols: 80, rows: 24, lease_ms: 5000 })).lease_ms, 5000);
  host.stop();
});

test('the host sends ready first, then the replay and the live output by offset with no gap and no byte twice, and the end carries last_offset', timeout, async () => {
  const host = createHost();
  const { cap } = await make(host);
  const page = pageOf(host, cap);
  await page.until('ready', () => page.ready !== undefined);
  assert.equal(page.frames[0].kind, 'ready', 'ready is the first frame, always');
  assert.equal(page.ready.v, 1);
  assert.equal(page.ready.start, 0);
  assert.equal(page.ready.lost, 0);
  assert.deepEqual(page.ready.size, { cols: 80, rows: 24 });
  assert.equal(page.ready.session.id, 't');
  assert.equal(JSON.stringify(page.ready).includes(cap), false, 'ready never says the capability');
  assert.equal(page.ready.lease_ms, LIMITS.lease_default_ms);
  host.flood('t', 3000, 80);
  await until(() => host.log.floods.length === 1);
  assert.ok(page.applied.length > 3, 'many frames');
  assert.equal(page.live, host.state('t').end - page.ready.end, 'every live byte was handed once');
  assert.equal(numbersOf(page.bytes()).at(-1), 2999);
  assert.deepEqual(numbersOf(page.bytes()), Array.from({ length: 3000 }, (_, at) => at));
  host.type('t', 'exit 3\r');
  await page.until('closed', () => page.closed);
  assert.equal(page.frames.at(-1).kind, 'ended');
  assert.equal(page.ended.reason, 'exited');
  assert.equal(page.ended.exit_code, 3);
  assert.equal(page.ended.last_offset, page.next, 'the end is after every byte the shell wrote');
  host.stop();
});

test('a stream that opens nothing is answered with the one frame, byte for byte, whatever the reason; a stream that breaks the protocol is closed with no answer', timeout, async () => {
  const host = createHost();
  const { cap } = await make(host);
  const wrongCap = `${cap.slice(0, 42)}${cap.endsWith('A') ? 'B' : 'A'}`;
  const encoder = new TextEncoder();
  const asked = (value) => {
    const body = encoder.encode(JSON.stringify(value));
    const frame = new Uint8Array(1 + body.length);
    frame[0] = FRAME.attach;
    frame.set(body, 1);
    return frame;
  };

  const first = [pageFrames.attach(wrongCap), pageFrames.attach('t'), pageFrames.attach(''), asked({ v: 2, cap }), asked({ cap }), asked({ v: 1, cap: 7 }), pageFrames.input('hi'), pageFrames.ack(1), new Uint8Array([0x99]), new Uint8Array(0), new Uint8Array([FRAME.attach]), pageFrames.attach('x'.repeat(1100))];
  for (const frame of first) {
    const page = pageOf(host, cap, { sendAttach: false });
    page.stream.send(frame);
    await page.until('closed', () => page.closed);
    assert.deepEqual(
      page.raw.map((bytes) => [...bytes]),
      [[FRAME.notFound]],
      'one frame of one byte, the same whatever the reason, and nothing after it',
    );
  }

  // After the attach: a second attach, a frame of the host's types, an unknown type, a size that is not one, a size out of range, and a frame that is too short or too long each close the stream with no answer, and the terminal is detached.
  const broken = [pageFrames.attach(cap), new Uint8Array([FRAME.ready, 1]), new Uint8Array([0x7f]), new Uint8Array([FRAME.resize, 0, 1]), pageFrames.resize(0, 24), pageFrames.resize(80, 1001), new Uint8Array([FRAME.ack, 0]), new Uint8Array([FRAME.detach, 1]), pageFrames.input(new Uint8Array(LIMITS.channel_max_input_bytes + 1))];
  for (const frame of broken) {
    const page = pageOf(host, cap);
    await page.until('ready', () => page.ready !== undefined);
    assert.equal(host.state('t').holder, page.stream.id);
    const before = page.raw.length;
    page.stream.send(frame);
    await page.until('closed', () => page.closed);
    assert.deepEqual(
      page.frames.map((read) => read.kind).filter((kind) => kind !== 'output'),
      ['ready'],
      'no answer once it has attached',
    );
    assert.equal(page.raw.slice(before).filter((bytes) => bytes[0] !== FRAME.output).length, 0, 'no reply of any kind to a malformed frame');
    assert.equal(host.state('t').holder, null, 'the terminal is detached as for any end of a stream');
  }

  // An attach from a point past the end of the output is not this terminal's offset: the stream closes with no answer.
  const past = pageOf(host, cap, { from: host.state('t').end + 1 });
  await past.until('closed', () => past.closed);
  assert.deepEqual(past.frames, []);
  host.stop();
});

test('a page that gives from_offset is replayed from exactly there when the ring has it, and told what is lost when it does not', timeout, async () => {
  const host = createHost({ leaseMs: 60_000, ringBytes: 200_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  host.flood('t', 1200, 80);
  await until(() => host.log.floods.length === 1);
  const mark = first.next;
  first.stream.close();
  assert.equal(host.state('t').holder, null);
  // Output while nobody holds the terminal goes into the ring, and the pump does not wait for anybody.
  host.append('t', 'while you were away\r\n');
  const kept = host.state('t');
  assert.equal(kept.end, mark + 'while you were away\r\n'.length);
  const second = pageOf(host, cap, { from: mark });
  await second.until('ready', () => second.ready !== undefined);
  assert.equal(second.ready.start, mark, 'the replay starts exactly where the page is');
  assert.equal(second.ready.lost, 0);
  assert.equal(second.ready.end, kept.end);
  assert.equal(second.ready.start, mark);
  await second.until('replay', () => second.next === second.ready.end);
  assert.equal(second.bytes().toString(), 'while you were away\r\n');
  second.stream.close();
  // The shell wrote more than the ring keeps while the page was away: the replay starts where the ring does, and the page is told how much of what it asked for is gone.
  host.flood('t', 4000, 80);
  await until(() => host.log.floods.length === 2);
  const state = host.state('t');
  assert.ok(state.start > mark, 'the ring moved past what the page has');
  assert.equal(state.overwritten, state.start);
  const third = pageOf(host, cap, { from: mark });
  await third.until('ready', () => third.ready !== undefined);
  assert.equal(third.ready.start, state.start);
  assert.equal(third.ready.lost, state.start - mark);
  await third.until('replay', () => third.next === third.ready.end);
  assert.equal(third.bytes().length, state.end - state.start);
  // A page with no offset is given the whole ring, with nothing lost.
  third.stream.close();
  const fresh = pageOf(host, cap);
  await fresh.until('ready', () => fresh.ready !== undefined);
  assert.equal(fresh.ready.lost, 0);
  assert.equal(fresh.ready.start, state.start);
  host.stop();
});

test('a reload under a flood joins with no gap and no duplicate: the lines are in order across the blip, and the page acknowledges only the live bytes', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  host.flood('t', 60_000, 80);
  await until(() => host.state('t').end >= 2_500_000);
  const reached = first.next;
  first.stream.close();
  // What the shell writes while nobody holds the terminal is a replay that is certainly not empty.
  host.append('t', 'written while you were away\r\n');
  const second = pageOf(host, cap, { from: reached });
  await second.until('ready', () => second.ready !== undefined);
  assert.equal(second.ready.start, reached);
  assert.ok(second.ready.end > second.ready.start, 'the replay is not empty');
  await until(() => host.log.floods.length === 1, 'the flood to end');
  await second.until('everything', () => second.next === host.state('t').end);
  const lines = numbersOf(Buffer.concat([...first.applied, ...second.applied]));
  assert.deepEqual(lines, Array.from({ length: 60_000 }, (_, at) => at), 'every line once and in order');
  assert.ok(Buffer.concat(second.applied).toString().includes('written while you were away'), 'the missed bytes were replayed');
  assert.equal(second.acked, host.state('t').end - second.ready.start, 'the new stream acknowledged every byte it was sent, the replay included');
  host.stop();
});

test('the modes are exact at the start of a replay, also after the bytes that set them fell out of the ring', timeout, async () => {
  const host = createHost({ leaseMs: 60_000, ringBytes: 500_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  host.append('t', '\u001b[?1049h\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?1h\u001b[?1004h\u001b[?25l');
  host.flood('t', 40_000, 80);
  await until(() => host.log.floods.length === 1);
  first.stream.close();
  const second = pageOf(host, cap);
  await second.until('ready', () => second.ready !== undefined);
  assert.ok(second.ready.start > 1000, 'the ring no longer holds the bytes that set the modes');
  for (const modes of [second.ready.start_modes, second.ready.modes]) assert.deepEqual({ ...modes }, MODES_ON);
  host.stop();
});

test('the modes are the same however the output is cut, and a ring answers them at every offset, and its start is at a boundary', () => {
  const sample = Buffer.from('ab\u001b[?1049h\u001b[?25lé\u001b]0;title\u0007\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?1049lcd\u001b[?25h\u001b[?1002h\u001b[?1003h\u001b[?1000l');
  const whole = new Scanner();
  whole.feed(sample);
  assert.deepEqual(whole.modes, { known: true, alt_screen: false, bracketed_paste: true, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 6, mouse_encoding: 2, kitty_keyboard: [] });
  for (let cut = 0; cut <= sample.length; cut += 1) {
    const parts = new Scanner();
    parts.feed(sample.subarray(0, cut));
    parts.feed(sample.subarray(cut));
    assert.deepEqual(parts.modes, whole.modes, `cut at ${String(cut)}`);
  }

  const ring = new Ring(80, 24);
  const big = Buffer.concat([sample, Buffer.alloc(70_000, 'x'), sample, Buffer.alloc(70_000, 'y')]);
  for (let at = 0; at < big.length; at += 777) ring.record(big.subarray(at, Math.min(big.length, at + 777)));
  assert.ok(ring.chunks.length >= 2);
  for (const offset of [0, 1, 5, 40, sample.length, sample.length + 100, 70_000, 70_100, ring.chunks[1].start, ring.chunks[1].start + 3, big.length - 1, big.length]) {
    const expected = new Scanner();
    expected.feed(big.subarray(0, offset));
    assert.deepEqual(ring.modesAt(offset), expected.modes, `at offset ${String(offset)}`);
  }

  // A ring that overwrites keeps what it holds at a boundary: its start is never inside an escape or a UTF-8 sequence, and it counts what it lost.
  const small = new Ring(80, 24, 100_000);
  const cut = Buffer.concat([Buffer.alloc(65_530, 'a'), Buffer.from('\u001b[?1049h'), Buffer.alloc(65_530, 'b'), Buffer.from('é'.repeat(40_000))]);
  for (let at = 0; at < cut.length; at += 1000) small.record(cut.subarray(at, Math.min(cut.length, at + 1000)));
  assert.ok(small.start > 0);
  assert.equal(small.overwritten, small.start);
  const held = small.read(small.start, small.end);
  assert.equal(held.length, small.end - small.start);
  assert.ok(held[0] < 0x80 || held[0] >= 0xc0, 'the ring does not start inside a UTF-8 sequence');
  const scanner = new Scanner();
  scanner.feed(held.subarray(0, 4));
  assert.equal(scanner.boundary, true);
});

test('the holder is the stream: a second stream takes the terminal, the first is told and cannot type, and a stream that ends detaches it', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  first.stream.send(pageFrames.input('zz'));
  assert.equal(host.log.writes.at(-1).data, 'zz');
  const second = pageOf(host, cap);
  await first.until('taken', () => first.closed);
  assert.equal(first.frames.at(-1).kind, 'taken-over');
  assert.equal(host.state('t').holder, second.stream.id);
  assert.equal(host.log.taken.length, 1);
  // The displaced stream cannot type, and its acknowledgements count for nothing.
  const writes = host.log.writes.length;
  first.stream.send(pageFrames.input('no'));
  first.stream.send(pageFrames.ack(5));
  assert.equal(host.log.writes.length, writes);
  await second.until('ready', () => second.ready !== undefined);
  second.stream.send(pageFrames.input('yes'));
  assert.equal(host.log.writes.at(-1).data, 'yes');
  assert.equal(host.log.writes.at(-1).stream, second.stream.id);
  // A detach frame lets it go at once and the host closes the stream.
  second.stream.send(pageFrames.detach());
  await second.until('closed', () => second.closed);
  assert.equal(host.state('t').holder, null);
  assert.equal(host.log.detaches.length, 1);
  const listed = await host.call('ListChannelTerminals', [[cap]]);
  assert.equal(listed[0].attached, false);
  assert.ok(listed[0].lease_expires_unix_ms > 0, 'a detached terminal says when it ends');
  host.stop();
});

test('a terminal is on its lease from the moment it is made, the first stream ends it, and at the end of a lease the terminal closes in silence and its capability opens nothing', timeout, async () => {
  const host = createHost({ leaseMs: 20 });
  const { cap } = await make(host);
  const early = await make(host, 'early');
  // The first stream that shows the capability ends the lease: the terminal outlives it.
  const page = pageOf(host, cap);
  await page.until('ready', () => page.ready !== undefined);
  await until(() => !host.ids().includes('early'));
  assert.deepEqual(host.ids(), ['t'], 'a terminal nobody took ends at its lease');
  await assert.rejects(host.call('CloseChannelTerminal', [early.cap]), (error) => JSON.parse(error.message).type === 'omniview:session/not-found');
  // A stream that ends starts the lease again; a stream that takes the terminal in time ends it again.
  page.stream.close();
  const back = pageOf(host, cap);
  await back.until('ready', () => back.ready !== undefined);
  assert.deepEqual(host.ids(), ['t']);
  back.stream.close();
  await until(() => host.ids().length === 0);
  assert.equal(host.log.closed.length, 0, 'the lease is not a close of the page');
  const late = pageOf(host, cap);
  await late.until('closed', () => late.closed);
  assert.deepEqual(
    late.frames.map((read) => read.kind),
    ['not-found'],
  );
  host.stop();
});

test('the window of acknowledgements: nothing is held back until the first acknowledgement, then at most channel_inflight_bytes are sent and not acknowledged (the replay counts), frames are cut to the credit that is left, and an acknowledgement of a stream that does not hold the terminal counts for nothing', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap, { ack: false });
  await first.until('ready', () => first.ready !== undefined);
  // No acknowledgement yet: the window is off, and the transport is the only limit.
  host.append('t', 'x'.repeat(1_200_000));
  await until(() => host.state('t').unsent === 0);
  assert.equal(first.next, first.ready.end + 1_200_000, 'a page that never acknowledges is limited only by the transport');
  first.stream.close();
  // A fresh terminal, a page whose first acknowledgement, of nothing, turns the window on, and a shell that writes three window's worth.
  const other = await make(host, 'o');
  const page = pageOf(host, other.cap, { ack: false });
  await page.until('ready', () => page.ready !== undefined);
  page.stream.send(pageFrames.ack(0));
  host.append('o', 'y'.repeat(3_000_000));
  await until(() => host.state('o').paused);
  const state = host.state('o');
  assert.equal(state.unacked, LIMITS.channel_inflight_bytes, 'a whole window is sent and not acknowledged, replay included');
  assert.equal(page.next, LIMITS.channel_inflight_bytes, 'and not a byte more');
  assert.ok(state.unsent >= LIMITS.channel_high_bytes - LIMITS.channel_frame_bytes, 'the pump read up to its mark and waits for a page that is alive');
  assert.ok(state.waiting > 0, 'the shell blocks in its own write');
  // An acknowledgement frees exactly that much credit, and the frame that follows is cut to it.
  const sent = page.next;
  page.stream.send(pageFrames.ack(1000));
  await page.until('credit', () => page.next === sent + 1000);
  assert.equal(page.frames.at(-1).bytes.length, 1000, 'a frame is cut to the credit that is left');
  assert.equal(host.log.maxUnacked, LIMITS.channel_inflight_bytes);
  // A stream that does not hold the terminal gets nothing for its acknowledgement.
  const stale = host.openStream(() => undefined);
  stale.send(pageFrames.attach(other.cap));
  await page.until('taken', () => page.closed);
  const credited = host.log.acked;
  page.stream.send(pageFrames.ack(1_000_000));
  assert.equal(host.log.acked, credited, 'an acknowledgement of a stream that does not hold the terminal counts for nothing');
  host.stop();
});

test('the pump never depends on the page: with nobody holding the terminal it reads on and the ring overwrites; with a page that holds it and does not acknowledge it waits at the mark and goes on once the page has taken what it was sent', timeout, async () => {
  const small = createHost({ leaseMs: 60_000, ringBytes: 400_000 });
  await make(small);
  small.append('t', 'z'.repeat(2_000_000));
  assert.equal(small.state('t').waiting, 0, 'nobody holds it: everything is read');
  assert.ok(small.state('t').start > 0, 'the ring overwrote its oldest bytes');
  small.stop();
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  host.append('t', 'z'.repeat(2_000_000));
  assert.equal(host.state('t').waiting, 0, 'nobody holds it: everything is read');
  const page = pageOf(host, cap, { ack: false });
  await page.until('ready', () => page.ready !== undefined);
  await page.until('replay', () => page.next === page.ready.end);
  let acked = page.next - page.ready.start;
  page.stream.send(pageFrames.ack(acked));
  host.append('t', 'q'.repeat(4_000_000));
  await until(() => host.state('t').paused);
  assert.ok(host.state('t').waiting > 0, 'the shell blocks in its own write');
  // The page takes what it was sent: the backlog comes down and the pump reads again, until the shell has written everything.
  while (host.state('t').waiting > 0 || host.state('t').unsent > 0) {
    const owed = page.next - page.ready.start - acked;
    if (owed > 0) {
      page.stream.send(pageFrames.ack(owed));
      acked += owed;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(host.state('t').paused, false);
  assert.equal(host.state('t').end - page.ready.start, page.next - page.ready.start);
  host.stop();
});

test('a shell that ends by itself leaves its end and its output until it is dismissed: the stream that holds it is sent every byte and then ended, and a stream that shows the capability later is given the output and the end', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const page = pageOf(host, cap);
  await page.until('ready', () => page.ready !== undefined);
  host.append('t', 'last words\r\n');
  host.type('t', 'exit 7\r');
  await page.until('closed', () => page.closed);
  assert.equal(page.frames.at(-1).kind, 'ended');
  assert.equal(page.ended.exit_code, 7);
  assert.ok(page.bytes().toString().includes('last words'), 'every byte before the end');
  const kept = host.keptEnds();
  assert.deepEqual(
    kept.map((entry) => entry.id),
    ['t'],
  );
  // Listed with how it ended; attached by a stream that is given ready with `ended`, the output from where it is, and the end again.
  const listed = await host.call('ListChannelTerminals', [[cap]]);
  assert.equal(listed[0].ended.exit_code, 7);
  const later = pageOf(host, cap, { from: 4 });
  await later.until('closed', () => later.closed);
  assert.deepEqual(
    later.frames.map((read) => read.kind),
    ['ready', ...later.frames.slice(1, -1).map(() => 'output'), 'ended'],
  );
  assert.equal(later.ready.ended.exit_code, 7);
  assert.equal(later.ready.start, 4);
  assert.equal(later.ready.busy.reason, 'ended');
  assert.equal(host.state('t'), undefined, 'nothing runs');
  // Dismissing it forgets it: the capability opens nothing.
  await host.call('DismissChannelTerminal', [cap]);
  await assert.rejects(host.call('DismissChannelTerminal', [cap]), (error) => JSON.parse(error.message).type === 'omniview:session/not-found');
  const gone = pageOf(host, cap);
  await gone.until('closed', () => gone.closed);
  assert.deepEqual(
    gone.frames.map((read) => read.kind),
    ['not-found'],
  );
  host.stop();
});

test('a terminal the host closed leaves nothing, an end that nobody held is kept, a close of a live terminal by dismissing it ends it, and more than sixteen kept ends lose the oldest first', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const closing = await make(host, 'closing');
  const page = pageOf(host, closing.cap);
  await page.until('ready', () => page.ready !== undefined);
  host.append('closing', 'bye\r\n');
  await host.call('CloseChannelTerminal', [closing.cap]);
  await page.until('closed', () => page.closed);
  assert.equal(page.ended.reason, 'closed');
  assert.equal(page.ended.closed_by, 'request');
  assert.ok(page.bytes().toString().includes('bye'));
  assert.equal(host.keptEnds().length, 0, 'a close leaves nothing');
  assert.deepEqual(host.log.closed, ['closing']);
  const quit = await make(host, 'quit');
  host.type('quit', 'quit\r');
  assert.equal(host.keptEnds().length, 0, 'a shutdown leaves nothing');
  const live = await make(host, 'live');
  await host.call('DismissChannelTerminal', [live.cap]);
  assert.equal(host.ids().includes('live'), false, 'a terminal that is alive is closed, not dismissed');
  void quit;
  // A shell that ended while nobody held it is kept.
  const caps = [];
  for (let n = 0; n < KEPT_ENDS + 3; n += 1) {
    const made = await make(host, `end-${String(n)}`);
    caps.push(made.cap);
    host.end(`end-${String(n)}`);
  }

  assert.equal(host.keptEnds().length, KEPT_ENDS);
  assert.deepEqual(
    host.keptEnds().map((entry) => entry.id),
    Array.from({ length: KEPT_ENDS }, (_, at) => `end-${String(at + 3)}`),
    'the oldest goes first',
  );
  const listed = await host.call('ListChannelTerminals', [caps]);
  assert.equal(listed.length, KEPT_ENDS);
  assert.ok(listed.every((entry) => entry.ended !== undefined));
  host.stop();
});

test('the answer of an attach can be held: the host has taken the terminal and told the stream that held it, the ready comes when it is let go, and the hold is for one attach', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  const hold = host.holdReady('t');
  const second = pageOf(host, cap);
  await first.until('taken', () => first.taken && first.closed);
  assert.equal(hold.held(), true);
  assert.equal(second.ready, undefined, 'the answer waits');
  assert.equal(host.state('t').holder, second.stream.id);
  hold.release();
  await second.until('ready', () => second.ready !== undefined);
  const third = pageOf(host, cap);
  await third.until('ready', () => third.ready !== undefined);
  host.stop();
});

test('faults are single ways of getting the host wrong: a replay that lacks its end, a ready that hides a gap, a list that never says free, modes lost, a taker that is never told', timeout, async () => {
  const lacking = createHost({ leaseMs: 60_000, faults: { replayGap: true } });
  const one = await make(lacking);
  const a = pageOf(lacking, one.cap);
  await a.until('ready', () => a.ready !== undefined);
  lacking.flood('t', 2000, 80);
  await until(() => lacking.log.floods.length === 1);
  a.stream.close();
  const b = pageOf(lacking, one.cap, { from: 0, join: false });
  await b.until('ready', () => b.ready !== undefined);
  assert.ok(b.ready.end > 100_000);
  lacking.stop();

  const hidden = createHost({ leaseMs: 60_000, ringBytes: 200_000, faults: { attachedHidden: true, modesLost: true, noTakenOver: true } });
  const two = await make(hidden);
  const c = pageOf(hidden, two.cap);
  await c.until('ready', () => c.ready !== undefined);
  hidden.append('t', '\u001b[?1049h');
  const d = pageOf(hidden, two.cap);
  await d.until('ready', () => d.ready !== undefined);
  assert.equal(c.closed, false, 'the displaced stream is never told');
  assert.deepEqual({ ...d.ready.modes }, { known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] });
  const writes = hidden.log.writes.length;
  c.stream.send(pageFrames.input('stale'));
  assert.equal(hidden.log.writes.length, writes, 'it cannot type all the same');
  assert.equal((await hidden.call('ListChannelTerminals', [[two.cap]]))[0].attached, false, 'the list never says that a stream holds a terminal');
  hidden.stop();
});

test('the shell prints what the find, menu and link sections of the probe look for: known, urls and dense, a program that asks for the mouse and gives it back, and the prompts it has written are counted; the faults take it out', timeout, async () => {
  const host = createHost();
  await make(host, 't');
  const prompts = host.log.prompts;
  assert.ok(prompts >= 1, 'the banner ends with the first prompt');
  host.type('t', 'known\rurls\rdense 3 2\r');
  const printed = text.decode(host.bytes('t'));
  assert.ok(KNOWN.every((line) => printed.includes(line)), 'every line of `known` is printed');
  assert.ok(URLS.every((line) => printed.includes(line)), 'every line of `urls` is printed');
  assert.equal(printed.split('needle needle').length - 1, 3, '`dense 3 2` prints three lines of two occurrences');
  assert.equal(host.log.prompts, prompts + 3, 'each command ends with a prompt');
  host.type('t', 'mouse-on\r');
  assert.equal(host.state('t').modes.mouse_tracking, 1, 'the program asks for the mouse');
  assert.equal(host.state('t').modes.mouse_encoding, 2, 'in the SGR encoding');
  host.type('t', 'mouse-off\r');
  assert.equal(host.state('t').modes.mouse_tracking, 0, 'and gives it back');
  host.stop();

  const faulty = createHost({ faults: { knownShort: true, capShort: true, mouseNever: true } });
  await make(faulty, 't');
  faulty.type('t', 'known\rdense 5 1\rmouse-on\r');
  const short = text.decode(faulty.bytes('t'));
  assert.ok(short.includes(KNOWN[3]) && !short.includes(KNOWN[4]), '`known` prints four of its six lines under knownShort');
  assert.equal(short.split('needle').length - 1, 1000, '`dense` writes a thousand lines under capShort');
  assert.equal(faulty.state('t').modes.mouse_tracking, 0, 'mouse-on never asks for the mouse under mouseNever');
  faulty.stop();
});

test('a ring is bounded whatever the shell writes: a sequence that stays open past the budget is abandoned, and a replay never starts inside one', () => {
  const ring = new Ring(80, 24, 100_000);
  ring.record(Buffer.from('\u001b]0;'));
  for (let at = 0; at < 40; at += 1) ring.record(Buffer.alloc(10_000, 'x'));
  assert.ok(ring.held <= 100_000 + 65_536 + 10_000, 'the ring does not keep an oversized chunk');
  assert.ok(ring.abandoned >= 1);
  assert.equal(ring.end - ring.start, ring.held);
});

test('a frame that waited and lost its right meanwhile is refused, a hold ends once and cancels its own timer, and a close that wins over a natural end leaves nothing', timeout, async () => {
  const host = createHost({ leaseMs: 60_000 });
  const { cap } = await make(host);
  const first = pageOf(host, cap);
  await first.until('ready', () => first.ready !== undefined);
  host.slow(1, Infinity);
  first.stream.send(pageFrames.input('held'));
  const second = pageOf(host, cap);
  await second.until('ready', () => second.ready !== undefined);
  host.release();
  assert.equal(host.log.writes.length, 0, 'the frame of the stream that lost the terminal is not applied');
  assert.equal(host.log.frames.find((entry) => entry.kind === 'write').outcome, 'refused');
  // A hold released early does not release the next one when its own timer would have fired.
  host.slow(1, 30);
  second.stream.send(pageFrames.input('a'));
  host.release();
  host.slow(1, Infinity);
  second.stream.send(pageFrames.input('b'));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(
    host.log.writes.map((entry) => entry.data),
    ['a'],
    'the first timer did not release the second hold',
  );
  host.release();
  assert.deepEqual(
    host.log.writes.map((entry) => entry.data),
    ['a', 'b'],
  );
  // A shell that exits while the holder has no credit is ending by itself; a close that comes then owns the end.
  const other = await make(host, 'o');
  const page = pageOf(host, other.cap, { ack: false });
  await page.until('ready', () => page.ready !== undefined);
  page.stream.send(pageFrames.ack(0));
  host.append('o', 'y'.repeat(2_000_000));
  host.type('o', 'exit 0\r');
  await host.call('CloseChannelTerminal', [other.cap]);
  assert.equal(host.keptEnds().some((entry) => entry.id === 'o'), false, 'a requested close leaves nothing');
  await assert.rejects(host.call('DismissChannelTerminal', [other.cap]), (error) => JSON.parse(error.message).type === 'omniview:session/not-found');
  assert.equal(page.ended.closed_by, 'request');
  host.stop();
});
