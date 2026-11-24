import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_DEADLINE_MS, CAPABILITY_SLOT, capabilityStorage, createTerminalChannels, loadTerminalChannels, type CapabilityStorage, type ChannelClient, type ChannelSocket } from './terminalChannel';
import type { ChannelEvents, TerminalChannels } from './channel';

// The terminal channel (docs/ui-next/terminal-channel-protocol.md): the one place that holds the capabilities of the terminals of this page and their streams. What is tested here is the binary framing both ways,
// the order of the handshake (the attach is the first frame, frames sent before the stream is open wait behind it), that every stream ends in exactly one of `ended`, `takenOver`, `notFound` or `closed`, what is
// forgotten when the host says a terminal is not there, where the capabilities are kept (a slot of the window, which never blocks the window), and that a capability is never in anything the page says. The host's
// client and the socket are fakes; nothing waits for a clock except the one deadline of the slot, which runs on fake timers.

/** A capability as the host makes one (43 characters of base64url), written so that it can be looked for in everything the channel says. */
const CAP = 'CANARYcapability0123456789-_abcdefghijklmnop';
const CAP_2 = 'SECONDcapability0123456789-_abcdefghijklmnop';
const CAP_3 = 'THIRDcapability0123456789-_abcdefghijklmnopq';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const u64 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};

const joined = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

const frame = (type: number, ...parts: readonly Uint8Array[]): Uint8Array => joined(Uint8Array.of(type), ...parts);
const jsonOf = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));
const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** A socket as the stream gives one: it refuses a send before it is open (as a WebSocket does), and says what it was given. */
class FakeSocket implements ChannelSocket {
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  closed = 0;
  readonly sent: Uint8Array[] = [];
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: Uint8Array): void {
    if (this.readyState !== 1) {
      throw new Error('InvalidStateError: the stream is not open');
    }

    this.sent.push(Uint8Array.from(data));
  }

  close(): void {
    this.closed += 1;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.fire('open', new Event('open'));
  }

  deliver(data: Uint8Array): ArrayBuffer {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    this.fire('message', new MessageEvent('message', { data: buffer }));
    return buffer;
  }

  deliverText(text: string): void {
    this.fire('message', new MessageEvent('message', { data: text }));
  }

  drop(): void {
    this.readyState = 3;
    this.fire('close', new Event('close'));
  }

  fail(): void {
    this.fire('error', new Event('error'));
  }

  private fire(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

type Calls = Array<readonly [string, ...unknown[]]>;

type Answers = {
  /** What `CreateTerminal` answers. */
  create: () => unknown;
  /** What each call rejects with, by name, when it does. */
  fails: Record<string, Error>;
  /** What `ListChannelTerminals` answers, given the capabilities. */
  list: (capabilities: readonly string[]) => unknown;
  busy: unknown;
};

type Rig = {
  readonly channels: TerminalChannels;
  readonly sockets: FakeSocket[];
  readonly opened: string[];
  readonly calls: Calls;
  readonly writes: string[];
  readonly warnings: string[];
  readonly answers: Answers;
  readonly storage: CapabilityStorage;
  readonly deps: Parameters<typeof createTerminalChannels>[0];
};

type RigOptions = { readonly saved?: Record<string, string>; readonly writeFails?: Error };

const notFound = (): Error => Object.assign(new Error('not found'), { type: 'omniview:session/not-found', title: 'Not found', status: 404, detail: 'The terminal was not found.' });

function rig(options: RigOptions = {}): Rig {
  const sockets: FakeSocket[] = [];
  const opened: string[] = [];
  const calls: Calls = [];
  const writes: string[] = [];
  const warnings: string[] = [];
  const answers: Answers = {
    create: () => ({ id: 't1', cap: CAP, shell: { name: 'zsh' }, limits: {} }),
    fails: {},
    list: (capabilities) => capabilities.map((cap) => ({ id: cap === CAP ? 't1' : cap === CAP_2 ? 't2' : 't3', shell: { name: 'zsh' } })),
    busy: { state: 'idle' },
  };
  const call = async (name: string, ...args: unknown[]): Promise<unknown> => {
    calls.push([name, ...args]);
    if (name in answers.fails) {
      return Promise.reject(answers.fails[name]);
    }

    return Promise.resolve(name === 'CreateTerminal' ? answers.create() : name === 'ListChannelTerminals' ? answers.list(args[0] as string[]) : name === 'ChannelTerminalBusy' ? answers.busy : undefined);
  };

  const client: ChannelClient = {
    CreateTerminal: async (opts, launch) => call('CreateTerminal', opts, launch),
    CloseChannelTerminal: async (cap) => call('CloseChannelTerminal', cap),
    DismissChannelTerminal: async (cap) => call('DismissChannelTerminal', cap),
    ChannelTerminalBusy: async (cap) => call('ChannelTerminalBusy', cap),
    ListChannelTerminals: async (caps) => call('ListChannelTerminals', caps),
  };
  const storage: CapabilityStorage = {
    read: async () => Promise.resolve(undefined),
    write: async (text) => {
      writes.push(text);
      return options.writeFails === undefined ? Promise.resolve() : Promise.reject(options.writeFails);
    },
  };
  const deps = {
    client,
    storage,
    openStream: (name: string) => {
      opened.push(name);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    warn: (message: string) => {
      warnings.push(message);
    },
    ...(options.saved === undefined ? {} : { saved: options.saved }),
  };
  return { channels: createTerminalChannels(deps), sockets, opened, calls, writes, warnings, answers, storage, deps };
}

type Said = Array<readonly [string, ...unknown[]]>;

/** The callbacks of a stream, in the order they were called. */
function recorder(): { readonly said: Said; readonly events: ChannelEvents } {
  const said: Said = [];
  const events: ChannelEvents = {
    ready: (ready) => {
      said.push(['ready', ready]);
    },
    output: (offset, bytes) => {
      said.push(['output', offset, bytes]);
    },
    gap: (from, to) => {
      said.push(['gap', from, to]);
    },
    ended: (end) => {
      said.push(['ended', end]);
    },
    takenOver: () => {
      said.push(['takenOver']);
    },
    notFound: () => {
      said.push(['notFound']);
    },
    closed: () => {
      said.push(['closed']);
    },
  };
  return { said, events };
}

function socketOf(r: Rig, index = 0): FakeSocket {
  const socket = r.sockets[index];
  expect(socket, 'a stream was opened').toBeDefined();
  if (socket === undefined) {
    throw new Error('no stream was opened');
  }

  return socket;
}

/** Lets what is ready run: no timer is involved. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

const attachJson = (socket: FakeSocket): unknown => {
  const first = socket.sent[0];
  expect(first, 'a first frame was sent').toBeDefined();
  return JSON.parse(decoder.decode((first ?? new Uint8Array()).subarray(1)));
};

/** Opens a stream for `t1` and returns it with what it said. */
function connected(r: Rig, fromOffset?: number): { readonly socket: FakeSocket; readonly said: Said; readonly link: ReturnType<TerminalChannels['connect']> } {
  const { said, events } = recorder();
  const link = r.channels.connect('t1', fromOffset, events);
  return { socket: socketOf(r), said, link };
}

describe('opening a stream', () => {
  it('opens the stream called terminal and asks for binary messages as ArrayBuffers: the name carries nothing secret, and the capability is in no address', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket } = connected(r);
    expect(r.opened).toEqual(['terminal']);
    expect(socket.binaryType).toBe('arraybuffer');
  });

  it('sends the attach as the first frame, with the capability and the protocol version, and no offset when the page has none', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket } = connected(r);
    socket.open();
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]?.[0]).toBe(0x01);
    expect(attachJson(socket)).toEqual({ v: 1, cap: CAP });
    expect(socket.sent[0]?.length).toBeLessThanOrEqual(1024);
  });

  it('carries the offset the page applied up to, and an offset of 0 is an offset', () => {
    const first = rig({ saved: { t1: CAP } });
    const a = connected(first, 4096);
    a.socket.open();
    expect(attachJson(a.socket)).toEqual({ v: 1, cap: CAP, from_offset: 4096 });
    const second = rig({ saved: { t1: CAP } });
    const b = connected(second, 0);
    b.socket.open();
    expect(attachJson(b.socket)).toEqual({ v: 1, cap: CAP, from_offset: 0 });
  });

  it('sends nothing before the stream is open, and what the feed sends meanwhile goes after the attach, in the order it was sent', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, link } = connected(r);
    link.input(bytesOf(0x61, 0x62));
    link.resize(120, 40);
    link.ack(0);
    link.input(bytesOf(0x63));
    expect(socket.sent).toHaveLength(0);
    expect(link.pending()).toBeGreaterThan(0);
    socket.open();
    expect(socket.sent.map((sent) => sent[0])).toEqual([0x01, 0x02, 0x03, 0x04, 0x02]);
    expect(Array.from(socket.sent[1] ?? [])).toEqual([0x02, 0x61, 0x62]);
    expect(Array.from(socket.sent[4] ?? [])).toEqual([0x02, 0x63]);
    expect(link.pending()).toBe(0);
  });

  it('counts what the transport still holds as pending', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, link } = connected(r);
    socket.open();
    socket.bufferedAmount = 7;
    expect(link.pending()).toBe(7);
    socket.bufferedAmount = 0;
    expect(link.pending()).toBe(0);
  });
});

describe('the frames the page sends', () => {
  const opened = () => {
    const r = rig({ saved: { t1: CAP } });
    const c = connected(r);
    c.socket.open();
    return c;
  };

  it('input is the type and the raw bytes', () => {
    const { socket, link } = opened();
    link.input(bytesOf(0x00, 0xff, 0x1b, 0x5b, 0x41));
    expect(Array.from(socket.sent[1] ?? [])).toEqual([0x02, 0x00, 0xff, 0x1b, 0x5b, 0x41]);
  });

  it('resize is the columns then the rows, each a big-endian u16', () => {
    const { socket, link } = opened();
    link.resize(120, 40);
    link.resize(1000, 1);
    expect(Array.from(socket.sent[1] ?? [])).toEqual([0x03, 0x00, 120, 0x00, 40]);
    expect(Array.from(socket.sent[2] ?? [])).toEqual([0x03, 0x03, 0xe8, 0x00, 0x01]);
  });

  it('ack is a big-endian u32, and an ack of nothing is a frame', () => {
    const { socket, link } = opened();
    link.ack(0);
    link.ack(9);
    link.ack(0x01020304);
    expect(Array.from(socket.sent[1] ?? [])).toEqual([0x04, 0, 0, 0, 0]);
    expect(Array.from(socket.sent[2] ?? [])).toEqual([0x04, 0, 0, 0, 9]);
    expect(Array.from(socket.sent[3] ?? [])).toEqual([0x04, 1, 2, 3, 4]);
  });

  it('detach is the type alone', () => {
    const { socket, link } = opened();
    link.detach();
    expect(Array.from(socket.sent[1] ?? [])).toEqual([0x05]);
  });
});

describe('the frames the host sends', () => {
  const opened = () => {
    const r = rig({ saved: { t1: CAP } });
    const c = connected(r);
    c.socket.open();
    return { r, ...c };
  };

  it('hands ready on parsed and unchecked', () => {
    const { socket, said } = opened();
    const ready = { v: 1, start: 0, end: 8, lost: 0, size: { cols: 100, rows: 30 }, extra: ['kept'] };
    socket.deliver(frame(0x81, jsonOf(ready)));
    expect(said).toEqual([['ready', ready]]);
  });

  it('reads the offset of output as a big-endian u64 and hands on the bytes after it', () => {
    const { socket, said } = opened();
    socket.deliver(frame(0x82, u64(0x0102030405), encoder.encode('hi\r\n')));
    socket.deliver(frame(0x82, u64(0), bytesOf(0xff)));
    expect(said.map(([name, offset, bytes]) => [name, offset, Array.from(bytes as Uint8Array)])).toEqual([
      ['output', 0x0102030405, Array.from(encoder.encode('hi\r\n'))],
      ['output', 0, [0xff]],
    ]);
  });

  it('hands on bytes that are the feed\'s to keep: a later message does not change them', () => {
    const { socket, said } = opened();
    const buffer = socket.deliver(frame(0x82, u64(0), bytesOf(1, 2, 3)));
    new Uint8Array(buffer).fill(0);
    expect(Array.from((said[0]?.[2] as Uint8Array | undefined) ?? [])).toEqual([1, 2, 3]);
  });

  it('reads a gap as its two big-endian u64s', () => {
    const { socket, said } = opened();
    socket.deliver(frame(0x83, u64(65536), u64(5242880)));
    expect(said).toEqual([['gap', 65536, 5242880]]);
  });

  it('hands ended on parsed, once, and closes the stream itself', () => {
    const { socket, said } = opened();
    const end = { reason: 'exited', exit_code: 0, last_offset: 9 };
    socket.deliver(frame(0x84, jsonOf(end)));
    expect(said).toEqual([['ended', end]]);
    expect(socket.closed).toBeGreaterThan(0);
  });

  it('keeps the order the host sent them in', () => {
    const { socket, said } = opened();
    socket.deliver(frame(0x81, jsonOf({ v: 1 })));
    socket.deliver(frame(0x82, u64(0), bytesOf(1)));
    socket.deliver(frame(0x83, u64(1), u64(9)));
    socket.deliver(frame(0x82, u64(9), bytesOf(2)));
    socket.deliver(frame(0x84, jsonOf({ reason: 'closed' })));
    expect(said.map((one) => one[0])).toEqual(['ready', 'output', 'gap', 'output', 'ended']);
  });
});

describe('the end of a stream', () => {
  const ends: ReadonlyArray<readonly [string, (socket: FakeSocket) => void]> = [
    ['ended', (socket) => socket.deliver(frame(0x84, jsonOf({ reason: 'exited', last_offset: 0 })))],
    ['takenOver', (socket) => socket.deliver(frame(0x85))],
    ['notFound', (socket) => socket.deliver(frame(0x86))],
    ['closed', (socket) => {
      socket.drop(); 
    }],
  ];

  it.each(ends)('is told as %s, once, and nothing is told after it: no frame, no second end, and nothing is sent', (name, end) => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said, link } = connected(r);
    socket.open();
    end(socket);
    const sent = socket.sent.length;
    expect(said.map((one) => one[0])).toEqual([name]);
    socket.deliver(frame(0x81, jsonOf({ v: 1 })));
    socket.deliver(frame(0x82, u64(0), bytesOf(1)));
    socket.deliver(frame(0x83, u64(0), u64(1)));
    socket.deliver(frame(0x84, jsonOf({ reason: 'closed' })));
    socket.deliver(frame(0x85));
    socket.deliver(frame(0x86));
    socket.drop();
    socket.fail();
    link.input(bytesOf(1));
    link.resize(80, 24);
    link.ack(1);
    link.detach();
    expect(said.map((one) => one[0])).toEqual([name]);
    expect(socket.sent).toHaveLength(sent);
  });

  it.each(ends.filter(([name]) => name !== 'closed'))('closes the stream itself after %s', (_name, end) => {
    const r = rig({ saved: { t1: CAP } });
    const { socket } = connected(r);
    socket.open();
    end(socket);
    expect(socket.closed).toBeGreaterThan(0);
  });

  it('is closed when the stream fails', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said } = connected(r);
    socket.fail();
    expect(said.map((one) => one[0])).toEqual(['closed']);
    socket.drop();
    expect(said.map((one) => one[0])).toEqual(['closed']);
  });

  it.each<readonly [string, (socket: FakeSocket) => void]>([
    ['a frame of a type nobody sends', (socket) => socket.deliver(frame(0x99))],
    ['a frame of a type that is the page\'s', (socket) => socket.deliver(frame(0x02, bytesOf(1)))],
    ['an empty message', (socket) => socket.deliver(new Uint8Array())],
    ['an output with no room for its offset', (socket) => socket.deliver(frame(0x82, bytesOf(0, 0, 0)))],
    ['a gap that is too short', (socket) => socket.deliver(frame(0x83, u64(1)))],
    ['a ready that is not JSON', (socket) => socket.deliver(frame(0x81, encoder.encode('{nope')))],
    ['an ended that is not JSON', (socket) => socket.deliver(frame(0x84, encoder.encode('')))],
    ['a message that is text', (socket) => {
      socket.deliverText('hello'); 
    }],
  ])('is closed, once, by %s, and the stream is let go', (_name, bad) => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said } = connected(r);
    socket.open();
    bad(socket);
    expect(said.map((one) => one[0])).toEqual(['closed']);
    expect(socket.closed).toBeGreaterThan(0);
    socket.deliver(frame(0x82, u64(0), bytesOf(1)));
    expect(said.map((one) => one[0])).toEqual(['closed']);
  });

  it('closes the stream without a word when the feed closes the link: no event, then or later', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said, link } = connected(r);
    socket.open();
    link.close();
    expect(socket.closed).toBeGreaterThan(0);
    socket.deliver(frame(0x82, u64(0), bytesOf(1)));
    socket.drop();
    link.input(bytesOf(1));
    expect(said).toEqual([]);
    expect(socket.sent).toHaveLength(1);
  });

  it('lets a detach reach the host, and leaves the closing of the stream to the host', () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said, link } = connected(r);
    socket.open();
    link.detach();
    expect(Array.from(socket.sent.at(-1) ?? [])).toEqual([0x05]);
    socket.drop();
    expect(said.map((one) => one[0])).toEqual(['closed']);
  });
});

describe('a terminal the page holds no capability for', () => {
  it('is not found, once, without opening a stream, and the link it answers does nothing', async () => {
    const r = rig();
    const { said, events } = recorder();
    const link = r.channels.connect('t1', undefined, events);
    link.input(bytesOf(1));
    link.resize(80, 24);
    link.ack(1);
    link.detach();
    expect(link.pending()).toBe(0);
    await turns();
    expect(said).toEqual([['notFound']]);
    expect(r.opened).toEqual([]);
  });

  it('says nothing when the feed closed the link before it was told: no event follows a close', async () => {
    const r = rig();
    const { said, events } = recorder();
    r.channels.connect('t1', undefined, events).close();
    await turns();
    expect(said).toEqual([]);
  });

  it('answers every call as the host answers a capability that opens nothing, and does not call the host', async () => {
    const r = rig();
    for (const call of [r.channels.close('t1'), r.channels.dismiss('t1'), r.channels.busy('t1')]) {
      const error = await call.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(r.channels.isGone(error)).toBe(true);
    }

    expect(await r.channels.listed('t1')).toBeUndefined();
    expect(r.calls).toEqual([]);
  });
});

describe('a terminal the host says is not there', () => {
  it('forgets its capability on not-found: a later stream, and every later call, answers not found without the host being asked', async () => {
    const r = rig({ saved: { t1: CAP } });
    const { socket, said } = connected(r);
    socket.open();
    socket.deliver(frame(0x86));
    expect(said).toEqual([['notFound']]);
    const again = recorder();
    r.channels.connect('t1', undefined, again.events);
    await turns();
    expect(again.said).toEqual([['notFound']]);
    expect(r.opened).toEqual(['terminal']);
    for (const call of [r.channels.close('t1'), r.channels.dismiss('t1'), r.channels.busy('t1')]) {
      const error = await call.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(r.channels.isGone(error)).toBe(true);
    }

    expect(r.calls).toEqual([]);
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({});
  });

  it('keeps its capability on taken-over and on a dropped stream: the terminal may be taken back or reached again', () => {
    const r = rig({ saved: { t1: CAP } });
    const first = connected(r);
    first.socket.open();
    first.socket.deliver(frame(0x85));
    const second = recorder();
    r.channels.connect('t1', 5, second.events);
    const next = socketOf(r, 1);
    next.open();
    expect(attachJson(next)).toEqual({ v: 1, cap: CAP, from_offset: 5 });
    next.drop();
    r.channels.connect('t1', undefined, recorder().events);
    expect(r.opened).toHaveLength(3);
  });

  it('forgets a capability the host refuses in any call', async () => {
    const r = rig({ saved: { t1: CAP } });
    r.answers.fails.ChannelTerminalBusy = notFound();
    const error = await r.channels.busy('t1').then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(r.channels.isGone(error)).toBe(true);
    r.calls.length = 0;
    await r.channels.close('t1').catch(() => undefined);
    expect(r.calls).toEqual([]);
  });
});

describe('creating a terminal', () => {
  it('asks the host for a channel terminal of this size and lease, under this id', async () => {
    const r = rig();
    await r.channels.create('t1', { cols: 100, rows: 30, leaseMs: 60_000 });
    expect(r.calls).toHaveLength(1);
    const [name, options, launch] = r.calls[0] ?? [];
    expect(name).toBe('CreateTerminal');
    expect(options).toMatchObject({ id: 't1', tty: true, command: [] });
    expect(launch).toEqual({ channel: true, cols: 100, rows: 30, lease_ms: 60_000 });
  });

  it('says nothing of the lease when it was not given', async () => {
    const r = rig();
    await r.channels.create('t1', { cols: 80, rows: 24 });
    expect(r.calls[0]?.[2]).toEqual({ channel: true, cols: 80, rows: 24 });
  });

  it('answers the host\'s session without the capability, and attaches with the capability afterwards', async () => {
    const r = rig();
    const session = await r.channels.create('t1', { cols: 80, rows: 24 });
    expect(session).toMatchObject({ id: 't1', shell: { name: 'zsh' } });
    expect(JSON.stringify(session)).not.toContain(CAP);
    expect(session).not.toHaveProperty('cap');
    const { socket } = connected(r);
    socket.open();
    expect(attachJson(socket)).toEqual({ v: 1, cap: CAP });
  });

  it.each<readonly [string, unknown]>([
    ['no session', null],
    ['a session without a capability', { id: 't1' }],
    ['a capability that is not text', { id: 't1', cap: 5 }],
    ['an empty capability', { id: 't1', cap: '' }],
  ])('rejects, and keeps nothing, when the host answers %s', async (_name, answer) => {
    const r = rig();
    r.answers.create = () => answer;
    await expect(r.channels.create('t1', { cols: 80, rows: 24 })).rejects.toBeInstanceOf(Error);
    const later = recorder();
    r.channels.connect('t1', undefined, later.events);
    await turns();
    expect(r.opened).toEqual([]);
    expect(later.said).toEqual([['notFound']]);
  });

  it('rejects with the host\'s error, and keeps nothing, when the host refuses', async () => {
    const r = rig();
    const refusal = new Error('the shell could not start');
    r.answers.fails.CreateTerminal = refusal;
    await expect(r.channels.create('t1', { cols: 80, rows: 24 })).rejects.toBe(refusal);
    r.channels.connect('t1', undefined, recorder().events);
    await turns();
    expect(r.opened).toEqual([]);
  });
});

describe('the calls that name a terminal', () => {
  it('close asks the host with the capability, then forgets it', async () => {
    const r = rig({ saved: { t1: CAP } });
    await r.channels.close('t1');
    expect(r.calls).toEqual([['CloseChannelTerminal', CAP]]);
    await expect(r.channels.close('t1')).rejects.toSatisfy((error: unknown) => r.channels.isGone(error));
    expect(r.calls).toHaveLength(1);
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({});
  });

  it('dismiss asks the host with the capability, then forgets it', async () => {
    const r = rig({ saved: { t1: CAP } });
    await r.channels.dismiss('t1');
    expect(r.calls).toEqual([['DismissChannelTerminal', CAP]]);
    await expect(r.channels.dismiss('t1')).rejects.toSatisfy((error: unknown) => r.channels.isGone(error));
    expect(r.calls).toHaveLength(1);
  });

  it('keeps the capability when a close fails for any other reason: the terminal may still be there', async () => {
    const r = rig({ saved: { t1: CAP } });
    const failure = new Error('the host is busy');
    r.answers.fails.CloseChannelTerminal = failure;
    await expect(r.channels.close('t1')).rejects.toBe(failure);
    await r.channels.close('t1').catch(() => undefined);
    expect(r.calls).toHaveLength(2);
  });

  it('forgets the capability when the close or the dismiss is answered not found, and rejects with that answer', async () => {
    const r = rig({ saved: { t1: CAP, t2: CAP_2 } });
    const gone = notFound();
    r.answers.fails.CloseChannelTerminal = gone;
    r.answers.fails.DismissChannelTerminal = gone;
    await expect(r.channels.close('t1')).rejects.toBe(gone);
    await expect(r.channels.dismiss('t2')).rejects.toBe(gone);
    await expect(r.channels.busy('t1')).rejects.toSatisfy((error: unknown) => r.channels.isGone(error));
    await expect(r.channels.busy('t2')).rejects.toSatisfy((error: unknown) => r.channels.isGone(error));
    expect(r.calls).toHaveLength(2);
  });

  it('busy answers what the host answers', async () => {
    const r = rig({ saved: { t1: CAP } });
    r.answers.busy = { state: 'busy', name: 'sleep' };
    await expect(r.channels.busy('t1')).resolves.toEqual({ state: 'busy', name: 'sleep' });
    expect(r.calls).toEqual([['ChannelTerminalBusy', CAP]]);
  });
});

describe('listing the terminals', () => {
  it('asks with the capabilities it holds, in the order it learnt them, and answers what the host listed in the host\'s order', async () => {
    const r = rig({ saved: { t1: CAP, t2: CAP_2, t3: CAP_3 } });
    const listed = [
      { id: 't3', shell: { name: 'bash' } },
      { id: 't1', shell: { name: 'zsh' }, ended: { reason: 'exited' } },
      { id: 't2', shell: { name: 'fish' } },
    ];
    r.answers.list = () => listed;
    await expect(r.channels.list()).resolves.toEqual(listed);
    expect(r.calls).toEqual([['ListChannelTerminals', [CAP, CAP_2, CAP_3]]]);
  });

  it('asks nothing when it holds nothing', async () => {
    const r = rig();
    await expect(r.channels.list()).resolves.toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('forgets the capabilities the host answered nothing for, once the host has answered, and keeps the others', async () => {
    const r = rig({ saved: { t1: CAP, t2: CAP_2, t3: CAP_3 } });
    r.answers.list = () => [{ id: 't3' }, { id: 't1' }];
    await r.channels.list();
    await turns();
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({ t1: CAP, t3: CAP_3 });
    const gone = recorder();
    r.channels.connect('t2', undefined, gone.events);
    await turns();
    expect(gone.said).toEqual([['notFound']]);
    expect(r.opened).toEqual([]);
    connected(r);
    expect(r.opened).toEqual(['terminal']);
  });

  it('forgets nothing when the host does not answer: a failed listing says nothing of the terminals', async () => {
    const r = rig({ saved: { t1: CAP, t2: CAP_2 } });
    const failure = new Error('the host is not there');
    r.answers.fails.ListChannelTerminals = failure;
    await expect(r.channels.list()).rejects.toBe(failure);
    await turns();
    expect(r.writes).toEqual([]);
    r.answers.fails = {};
    r.answers.list = () => [{ id: 't1' }, { id: 't2' }];
    await r.channels.list();
    expect(r.calls.at(-1)).toEqual(['ListChannelTerminals', [CAP, CAP_2]]);
  });

  it('forgets nothing when the answer is not a list', async () => {
    const r = rig({ saved: { t1: CAP } });
    r.answers.list = () => ({ id: 't1' });
    await expect(r.channels.list()).rejects.toBeInstanceOf(Error);
    await turns();
    expect(r.writes).toEqual([]);
  });

  it('does not forget a capability that was made while the host was answering', async () => {
    const r = rig({ saved: { t1: CAP } });
    let answer: (value: unknown) => void = () => undefined;
    r.answers.list = async () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const listing = r.channels.list();
    await turns();
    r.answers.create = () => ({ id: 't2', cap: CAP_2 });
    await r.channels.create('t2', { cols: 80, rows: 24 });
    answer([]);
    await listing;
    await turns();
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({ t2: CAP_2 });
  });

  it('listed answers the host\'s entry for one terminal, asks with that capability alone, and never opens a stream', async () => {
    const r = rig({ saved: { t1: CAP, t2: CAP_2 } });
    await expect(r.channels.listed('t2')).resolves.toMatchObject({ id: 't2' });
    expect(r.calls).toEqual([['ListChannelTerminals', [CAP_2]]]);
    expect(r.opened).toEqual([]);
  });

  it('listed answers nothing when the host has no entry, and does not forget the capability', async () => {
    const r = rig({ saved: { t1: CAP } });
    r.answers.list = () => [];
    await expect(r.channels.listed('t1')).resolves.toBeUndefined();
    await turns();
    expect(r.writes).toEqual([]);
    connected(r);
    expect(r.opened).toEqual(['terminal']);
  });
});

describe('the errors of the host', () => {
  const envelope = (type: string, extra: Record<string, unknown> = {}) => ({ type, title: 'Title', status: 404, detail: 'The detail.', ...extra });

  it('reads them as the runtime does: the sentence, the typed code, the shells tried', () => {
    const { channels } = rig();
    expect(channels.describe(envelope('omniview:terminal/shell-unavailable', { detail: 'No shell could be started.' }))).toBe('No shell could be started.');
    expect(channels.codeOf(envelope('omniview:terminal/shell-unavailable', { code: 'SHELL_UNAVAILABLE' }))).toBe('SHELL_UNAVAILABLE');
    expect(channels.codeOf(envelope('omniview:terminal/shell-unavailable'))).toBeUndefined();
    expect(channels.triedOf(envelope('omniview:terminal/shell-unavailable', { tried: [{ source: 'account', path: '/bin/zsh', reason: 'not-found' }] }))).toEqual([{ source: 'account', path: '/bin/zsh', reason: 'not-found' }]);
  });

  it('knows the terminal is not there by the type of the answer, and by nothing else', () => {
    const { channels } = rig();
    expect(channels.isGone(envelope('omniview:session/not-found'))).toBe(true);
    expect(channels.isGone(envelope('omniview:internal'))).toBe(false);
    expect(channels.isGone(new Error('omniview:session/not-found'))).toBe(false);
    expect(channels.isGone(undefined)).toBe(false);
  });
});

describe('where the capabilities are kept', () => {
  it('writes the slot as a JSON object of id to capability on every change: a creation, a close, a dismissal, a not-found', async () => {
    const r = rig();
    await r.channels.create('t1', { cols: 80, rows: 24 });
    await turns();
    expect(r.writes.map((text) => JSON.parse(text) as unknown)).toEqual([{ t1: CAP }]);
    r.answers.create = () => ({ id: 't2', cap: CAP_2 });
    await r.channels.create('t2', { cols: 80, rows: 24 });
    await turns();
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({ t1: CAP, t2: CAP_2 });
    await r.channels.close('t1');
    await turns();
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({ t2: CAP_2 });
    await r.channels.dismiss('t2');
    await turns();
    expect(JSON.parse(r.writes.at(-1) ?? 'null')).toEqual({});
    expect(r.writes).toHaveLength(4);
  });

  it('writes in the order of the changes, one at a time, and the last write is what is now', async () => {
    const r = rig();
    const writes: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = createTerminalChannels({
      ...r.deps,
      storage: {
        read: r.storage.read,
        write: async (text) => {
          writes.push(text);
          if (writes.length === 1) {
            await held;
          }
        },
      },
    });
    await slow.create('t1', { cols: 80, rows: 24 });
    await turns();
    expect(writes).toHaveLength(1);
    await slow.close('t1');
    await turns();
    expect(writes).toHaveLength(1);
    release();
    await turns();
    expect(writes.map((text) => JSON.parse(text) as unknown)).toEqual([{ t1: CAP }, {}]);
  });

  it('is read by the loader: a terminal a page left is reached by the capability its slot kept', async () => {
    const r = rig();
    const stored = JSON.stringify({ t1: CAP, t2: CAP_2 });
    const channels = await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.resolve(stored), write: r.storage.write } });
    channels.connect('t2', 3, recorder().events);
    const socket = socketOf(r);
    socket.open();
    expect(attachJson(socket)).toEqual({ v: 1, cap: CAP_2, from_offset: 3 });
  });

  it('is what the window service keeps in its slot called terminal-capabilities, as JSON', async () => {
    const slots = new Map<string, string>();
    const calls: string[] = [];
    const client = {
      GetState: async (name: string) => {
        calls.push(`get ${name}`);
        return Promise.resolve(Object.fromEntries(slots));
      },
      SaveState: async (name: string, slot: string, json: string) => {
        calls.push(`save ${name} ${slot}`);
        slots.set(slot, json);
        return Promise.resolve();
      },
    };
    const storage = capabilityStorage({ client, name: async () => Promise.resolve('main') });
    expect(CAPABILITY_SLOT).toBe('terminal-capabilities');
    await expect(storage.read()).resolves.toBeUndefined();
    await storage.write('{"t1":"x"}');
    expect(slots.get('terminal-capabilities')).toBe('{"t1":"x"}');
    await expect(storage.read()).resolves.toBe('{"t1":"x"}');
    expect(calls).toEqual(['get main', 'save main terminal-capabilities', 'get main']);
  });

  it('is round-tripped: what one page wrote, the next page reads', async () => {
    const slots = new Map<string, string>();
    const client = {
      GetState: async () => Promise.resolve(Object.fromEntries(slots)),
      SaveState: async (_name: string, slot: string, json: string) => {
        slots.set(slot, json);
        return Promise.resolve();
      },
    };
    const storage = capabilityStorage({ client, name: async () => Promise.resolve('main') });
    const first = rig();
    const before = createTerminalChannels({ ...first.deps, storage });
    await before.create('t1', { cols: 80, rows: 24 });
    await turns();
    const second = rig();
    const after = await loadTerminalChannels({ ...second.deps, storage });
    after.connect('t1', undefined, recorder().events);
    const socket = socketOf(second);
    socket.open();
    expect(attachJson(socket)).toEqual({ v: 1, cap: CAP });
  });

  it('never blocks the window: a slot that cannot be read starts with no terminals, and says so without the capability', async () => {
    const r = rig();
    const channels = await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.reject(new Error(`the host did not answer for ${CAP}`)), write: r.storage.write } });
    expect(r.warnings.length).toBeGreaterThan(0);
    channels.connect('t1', undefined, recorder().events);
    await turns();
    expect(r.opened).toEqual([]);
    await expect(channels.create('t1', { cols: 80, rows: 24 })).resolves.toBeDefined();
  });

  it('never blocks the window: a slot that never answers is given up after the deadline', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      let done = false;
      const loading = loadTerminalChannels({ ...r.deps, storage: { read: async () => new Promise<string | undefined>(() => undefined), write: r.storage.write } }).then((channels) => {
        done = true;
        return channels;
      });
      await vi.advanceTimersByTimeAsync(CAPABILITY_DEADLINE_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await loading;
      expect(done).toBe(true);
      expect(r.warnings.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<readonly [string, string]>([
    ['text that is not JSON', 'this is not json'],
    ['a list', JSON.stringify([CAP])],
    ['a number', '5'],
    ['entries that are not text', JSON.stringify({ t1: 5, t2: null, t3: { cap: CAP } })],
    ['capabilities that cannot be one', JSON.stringify({ t1: '', t2: 'has a space', t3: 'x'.repeat(2000) })],
  ])('starts with no terminals, and says so, for a slot of %s', async (_name, text) => {
    const r = rig();
    const channels = await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.resolve(text), write: r.storage.write } });
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const id of ['t1', 't2', 't3']) {
      channels.connect(id, undefined, recorder().events);
    }

    await turns();
    expect(r.opened).toEqual([]);
  });

  it('keeps the entries of a slot that can be used, and drops those that cannot', async () => {
    const r = rig();
    const channels = await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.resolve(JSON.stringify({ t1: CAP, t2: 7 })), write: r.storage.write } });
    channels.connect('t1', undefined, recorder().events);
    channels.connect('t2', undefined, recorder().events);
    await turns();
    expect(r.opened).toEqual(['terminal']);
  });

  it('is not written for a slot that was read and said nothing: a window with no terminals writes nothing', async () => {
    const r = rig();
    await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.resolve(undefined), write: r.storage.write } });
    await turns();
    expect(r.writes).toEqual([]);
  });

  it('goes on when the slot cannot be written: the terminal is made and reached, and a note says so without the capability', async () => {
    const r = rig({ writeFails: new Error('could not save') });
    await expect(r.channels.create('t1', { cols: 80, rows: 24 })).resolves.toBeDefined();
    await turns();
    expect(r.warnings.length).toBeGreaterThan(0);
    connected(r);
    expect(r.opened).toEqual(['terminal']);
    await r.channels.close('t1');
    await turns();
    expect(r.warnings.length).toBeGreaterThan(1);
  });
});

describe('the capability, which nothing says', () => {
  let console_: Array<readonly unknown[]>;
  beforeEach(() => {
    console_ = [];
    const note = (...args: unknown[]): void => {
      console_.push(args);
    };

    for (const method of ['warn', 'error', 'log', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(note);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const messageOfError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const echoing = (text: string) => Object.assign(new Error('failed'), { type: 'omniview:internal', title: 'Failed', status: 500, detail: `the call failed for ${text}` });

  it('is in no note, no error and no console text, whatever fails and whatever the place echoes of it', async () => {
    const r = rig({ writeFails: new Error(`cannot save ${JSON.stringify({ t1: CAP })}`) });
    const broken = await loadTerminalChannels({ ...r.deps, storage: { read: async () => Promise.resolve(`{"t1": "${CAP}", "t2": 5, ${CAP}`), write: r.storage.write } });
    const failing = rig({ writeFails: new Error(`cannot save ${CAP}`) });
    const said: string[] = [];
    failing.answers.fails.ChannelTerminalBusy = echoing(CAP);
    failing.answers.fails.CloseChannelTerminal = echoing(CAP);
    failing.answers.fails.DismissChannelTerminal = echoing(CAP);
    failing.answers.fails.ListChannelTerminals = echoing(CAP);
    await failing.channels.create('t1', { cols: 80, rows: 24 });
    for (const call of [failing.channels.busy('t1'), failing.channels.close('t1'), failing.channels.dismiss('t1'), failing.channels.list()]) {
      const error = await call.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      said.push(failing.channels.describe(error));
    }

    await failing.channels.create('t1', { cols: 80, rows: 24 }).catch(() => undefined);
    await broken.create('t1', { cols: 80, rows: 24 });
    await turns();
    const { socket } = connected(failing);
    socket.open();
    socket.drop();
    const everything = JSON.stringify([said, r.warnings, failing.warnings, console_, failing.opened, r.opened]);
    expect(everything).not.toContain(CAP);
    expect(everything).not.toContain('CANARY');
    expect(failing.warnings.length).toBeGreaterThan(0);
    expect(said.every((sentence) => sentence.length > 0)).toBe(true);
  });

  it('is not in the error of a creation whose answer the page cannot keep', async () => {
    const r = rig();
    r.answers.create = () => ({ id: 't1', cap: `${CAP} with a space` });
    const error = await r.channels.create('t1', { cols: 80, rows: 24 }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify([messageOfError(error), r.channels.describe(error)])).not.toContain(CAP);
  });
});
