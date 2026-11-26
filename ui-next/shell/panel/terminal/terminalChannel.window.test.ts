import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalChannels } from './channel';

// The capability is never given to the host's window service (docs/ui-next/terminal-channel-protocol.md, section 2, "Where the capability lives"): `WindowClient.SaveState` keeps its slots on disk and its `GetState` and
// `ListStates` answer any window and any caller. The page's own channels (`appTerminalChannels`) are driven here through every path that touches a capability, with a fake window service that records every argument it is given,
// and the tab's real `sessionStorage` (a reload keeps it).

const CAP = 'CANARYcapability0123456789-_abcdefghijklmnop';

const world = vi.hoisted(() => ({
  saves: [] as unknown[][],
  reads: [] as unknown[][],
  slots: {},
  calls: [] as unknown[][],
  sockets: [] as Array<{ readonly url: string; readonly sent: Uint8Array[] }>,
}));

vi.mock('@omniviewdev/runtime/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WindowClient: {
    GetState: async (...args: unknown[]) => {
      world.reads.push(args);
      return Promise.resolve({ ...world.slots });
    },
    SaveState: async (...args: unknown[]) => {
      world.saves.push(args);
      return Promise.resolve();
    },
    ListStates: async (...args: unknown[]) => {
      world.reads.push(args);
      return Promise.resolve({});
    },
    List: async () => Promise.resolve([{ name: 'main' }]),
  },
  ExecClient: {
    CreateTerminal: async (...args: unknown[]) => {
      world.calls.push(['CreateTerminal', ...args]);
      return Promise.resolve({ id: 't1', cap: 'CANARYcapability0123456789-_abcdefghijklmnop', shell: { name: 'zsh' } });
    },
    CloseChannelTerminal: async (...args: unknown[]) => {
      world.calls.push(['CloseChannelTerminal', ...args]);
      return Promise.resolve();
    },
    DismissChannelTerminal: async (...args: unknown[]) => {
      world.calls.push(['DismissChannelTerminal', ...args]);
      return Promise.resolve();
    },
    ChannelTerminalBusy: async () => Promise.resolve({ state: 'idle' }),
    ListChannelTerminals: async (caps: string[]) => {
      world.calls.push(['ListChannelTerminals', caps]);
      return Promise.resolve(caps.map(() => ({ id: 't1', shell: { name: 'zsh' } })));
    },
  },
}));

vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Window: { Name: async () => Promise.resolve('main') },
}));

class FakeWebSocket {
  binaryType = 'blob';
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Uint8Array[] = [];
  constructor(readonly url: string) {
    world.sockets.push(this);
  }

  addEventListener(): void {
    // The tests of this file never read from the stream.
  }

  removeEventListener(): void {
    // See addEventListener.
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    // Nothing is held open.
  }
}

/** The module is made anew, as a reload makes it: the channels of the first page are gone, the tab's storage is not. */
async function page(): Promise<{ readonly channels: TerminalChannels; readonly load: () => TerminalChannels }> {
  vi.resetModules();
  const module = await import('./terminalChannel');
  return { channels: module.appTerminalChannels(), load: module.loadAppTerminalChannels };
}

const recorder = () => {
  const said: string[] = [];
  return {
    said,
    events: {
      ready: () => said.push('ready'),
      output: () => said.push('output'),
      gap: () => said.push('gap'),
      ended: () => said.push('ended'),
      applied: () => said.push('applied'),
      marks: () => said.push('marks'),
      takenOver: () => said.push('takenOver'),
      released: () => said.push('released'),
      closeRefused: () => said.push('closeRefused'),
      unsupported: () => said.push('unsupported'),
      notFound: () => said.push('notFound'),
      closed: () => said.push('closed'),
    },
  };
};

const turns = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  world.saves.length = 0;
  world.reads.length = 0;
  world.calls.length = 0;
  world.sockets.length = 0;
  world.slots = {};
  window.sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the capability and the host\'s window service', () => {
  it('is never passed to SaveState, whatever the page does with its terminals: create, list, connect, close, dismiss, and a reload that loads them again', async () => {
    const first = await page();
    first.load();
    await first.channels.create('t1', { cols: 80, rows: 24 });
    await first.channels.list();
    await first.channels.listed('t1');
    first.channels.connect('t1', undefined, recorder().events);
    await first.channels.busy('t1');

    const second = await page();
    const channels = second.load();
    await channels.list();
    await channels.close('t1');
    await first.channels.create('t1', { cols: 80, rows: 24 });
    await first.channels.dismiss('t1');
    await turns();

    expect(JSON.stringify(world.saves)).not.toContain(CAP);
    expect(world.saves).toEqual([]);
    expect(JSON.stringify(world.reads)).not.toContain(CAP);
  });

  it('is kept in the tab\'s sessionStorage, as id to capability, and a reload reaches the terminal by it', async () => {
    const first = await page();
    first.load();
    await first.channels.create('t1', { cols: 80, rows: 24 });
    const kept = window.sessionStorage.getItem('omniview.terminal-capabilities');
    expect(JSON.parse(kept ?? 'null')).toEqual({ t1: CAP });

    const second = await page();
    const channels = second.load();
    channels.connect('t1', 7, recorder().events);
    const socket = world.sockets.at(-1);
    expect(socket).toBeDefined();
    const attach = JSON.parse(new TextDecoder().decode((socket?.sent[0] ?? new Uint8Array()).subarray(1))) as unknown;
    expect(attach).toEqual({ v: 2, marks: 1, cap: CAP, from_offset: 7 });
  });

  it('is forgotten from the tab\'s storage when the terminal is closed', async () => {
    const first = await page();
    first.load();
    await first.channels.create('t1', { cols: 80, rows: 24 });
    await first.channels.close('t1');
    expect(JSON.parse(window.sessionStorage.getItem('omniview.terminal-capabilities') ?? 'null')).toEqual({});
  });

  it('is not read from the slot an earlier build kept in the window service: that slot is ignored, and the service is not asked', async () => {
    world.slots = { 'terminal-capabilities': JSON.stringify({ t1: CAP }) };
    const { load } = await page();
    const channels = load();
    const heard = recorder();
    channels.connect('t1', undefined, heard.events);
    await turns();
    expect(heard.said).toEqual(['notFound']);
    expect(world.sockets).toEqual([]);
    expect(world.reads).toEqual([]);
  });
});
