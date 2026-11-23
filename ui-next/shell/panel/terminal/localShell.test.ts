import { describe, expect, it, vi } from 'vitest';
import { HOST } from '../../core/panel';
import { localShellTarget, localShellTransport, type ExecClientLike, type EventsLike } from './localShell';

// The host's own shell as a feed: `ExecClient.CreateTerminal` starts the user's login shell on a pty of this machine (backend/pkg/terminal/manager.go), and the session is read and written through the exec lane's
// events and calls. What is tested here is the mapping of the feed's transport onto the binding, as it is: the call and its arguments, the call number of an input call (the feed's, passed on as it is: the host
// orders the calls by it), the order of rows and columns, the events of a session, and what an error of the backend is called.

type Rig = {
  readonly client: ExecClientLike & { readonly calls: Array<readonly [string, ...unknown[]]> };
  readonly events: EventsLike & { readonly emit: (name: string, data: unknown) => void; readonly count: () => number };
};

function rig(): Rig {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const listeners = new Map<string, Set<(event: { readonly data: unknown }) => void>>();
  const client = {
    calls,
    CreateTerminal: async (options: unknown, launch: unknown) => {
      calls.push(['CreateTerminal', options, launch]);
      return Promise.resolve(null);
    },
    WriteTerminal: async (id: string, seq: number, data: string) => {
      calls.push(['WriteTerminal', id, seq, data]);
      return Promise.resolve();
    },
    ResizeTerminal: async (id: string, seq: number, rows: number, cols: number) => {
      calls.push(['ResizeTerminal', id, seq, rows, cols]);
      return Promise.resolve();
    },
    CloseSession: async (id: string) => {
      calls.push(['CloseSession', id]);
      return Promise.resolve();
    },
    AckTerminal: async (id: string, bytes: number) => {
      calls.push(['AckTerminal', id, bytes]);
      return Promise.resolve();
    },
    IsBusy: async (id: string) => {
      calls.push(['IsBusy', id]);
      return Promise.resolve({ state: 'busy', pgid: 812, name: 'sleep' });
    },
  };
  const events = {
    On: (name: string, listener: (event: { readonly data: unknown }) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
    emit: (name: string, data: unknown) => {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        listener({ data });
      }
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return { client, events };
}

describe('the transport of the host\'s own shell', () => {
  it('starts a login shell of this machine on a pty, under the id the feed chose, AT the size the view measured: a tty and no command, so the backend picks the user\'s own shell, and a launch of the columns and the rows and nothing else', async () => {
    const { client, events } = rig();
    await localShellTransport({ client, events }).create('term-1', { cols: 132, rows: 41 });
    expect(client.calls).toEqual([['CreateTerminal', { id: 'term-1', tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, { cols: 132, rows: 41 }]]);
  });

  it('writes and resizes with the call number it is given, unchanged, by the session\'s id, and takes rows BEFORE columns, as the binding does; closing carries no number', async () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    await transport.write('term-1', 1, 'bHM=');
    await transport.resize('term-1', 2, 41, 132);
    await transport.write('term-1', 41, 'YQ==');
    await transport.close('term-1');
    expect(client.calls).toEqual([
      ['WriteTerminal', 'term-1', 1, 'bHM='],
      ['ResizeTerminal', 'term-1', 2, 41, 132],
      ['WriteTerminal', 'term-1', 41, 'YQ=='],
      ['CloseSession', 'term-1'],
    ]);
  });

  it('hands each call to the binding in the tick it is made, in the order it is made, without waiting for any answer: the numbers are the feed\'s and the host puts the calls in their order', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    void transport.write('term-1', 7, 'YQ==');
    void transport.resize('term-1', 8, 24, 80);
    void transport.write('term-1', 9, 'Yg==');
    expect(client.calls).toEqual([
      ['WriteTerminal', 'term-1', 7, 'YQ=='],
      ['ResizeTerminal', 'term-1', 8, 24, 80],
      ['WriteTerminal', 'term-1', 9, 'Yg=='],
    ]);
  });

  it('listens to an event by name, hands the listener the event\'s data and nothing else, and gives back what stops it', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const heard = vi.fn();
    const stop = transport.on('core/exec/stream/stdout/term-1', heard);
    events.emit('core/exec/stream/stdout/term-1', 'aGk=');
    expect(heard).toHaveBeenCalledWith('aGk=');
    stop();
    events.emit('core/exec/stream/stdout/term-1', 'aGk=');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(events.count()).toBe(0);
  });

  it('calls an error of the backend by its detail, and knows the one that says the session is not there', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const gone = JSON.stringify({ type: 'omniview:session/not-found', title: 'Session not found', status: 404, detail: 'Session term-1 not found' });
    const other = JSON.stringify({ type: 'omniview:session/failed', title: 'Session failed', status: 500, detail: 'Failed to start terminal' });
    expect(transport.describe(new Error(other))).toBe('Failed to start terminal');
    expect(transport.isGone(new Error(gone))).toBe(true);
    expect(transport.isGone(new Error(other))).toBe(false);
    expect(transport.isGone(new Error('plain'))).toBe(false);
  });

  it('acknowledges what the screen took in by the session\'s id and the count of bytes, and asks what runs in the session by its id, handing back the backend\'s own answer', async () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    await transport.ack('term-1', 65_536);
    await expect(transport.busy('term-1')).resolves.toEqual({ state: 'busy', pgid: 812, name: 'sleep' });
    expect(client.calls).toEqual([
      ['AckTerminal', 'term-1', 65_536],
      ['IsBusy', 'term-1'],
    ]);
  });

  it('reads the typed code of an error of the backend, never its words, and nothing when it has none', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const unavailable = JSON.stringify({ type: 'omniview:terminal/shell-unavailable', title: 'Shell not found', status: 422, detail: 'shell executable unavailable: tried /bin/zsh: not found', code: 'SHELL_UNAVAILABLE' });
    const untyped = JSON.stringify({ type: 'omniview:session/failed', title: 'Session failed', status: 500, detail: 'SHELL_UNAVAILABLE in the words, not in the code' });
    expect(transport.codeOf(new Error(unavailable))).toBe('SHELL_UNAVAILABLE');
    expect(transport.describe(new Error(unavailable))).toBe('shell executable unavailable: tried /bin/zsh: not found');
    expect(transport.codeOf(new Error(untyped))).toBeUndefined();
    expect(transport.codeOf(new Error('plain'))).toBeUndefined();
  });

  it('reads the typed codes the host answers an input call with, as it sends them: a full queue (the call may be sent again), a number that was given up, a number too far ahead; none of them says the session is gone', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const refusal = (type: string, title: string, status: number, detail: string, code: string): Error => new Error(JSON.stringify({ type, title, status, detail, code }));
    const backlog = refusal('omniview:terminal/input-backlog', 'Terminal input backlog', 429, 'The terminal holds 256 operations or 1048576 bytes of input it has not applied yet. Send it again later.', 'INPUT_BACKLOG');
    const stale = refusal('omniview:terminal/sequence-stale', 'Stale input sequence number', 409, 'Sequence number 7 was already applied or given up; the next expected is 9.', 'SEQUENCE_STALE');
    const ahead = refusal('omniview:terminal/sequence-ahead', 'Input sequence number too far ahead', 400, 'Sequence number 90 is more than 64 past the next expected, 20.', 'SEQUENCE_AHEAD');
    expect([backlog, stale, ahead].map((error) => transport.codeOf(error))).toEqual(['INPUT_BACKLOG', 'SEQUENCE_STALE', 'SEQUENCE_AHEAD']);
    expect([backlog, stale, ahead].map((error) => transport.isGone(error))).toEqual([false, false, false]);
    expect(transport.describe(backlog)).toBe('The terminal holds 256 operations or 1048576 bytes of input it has not applied yet. Send it again later.');
  });
});

describe('the target of the host\'s own shell', () => {
  it('is the host\'s, called Terminal until the backend says which shell it runs, and starts a feed on `open`', () => {
    const { client, events } = rig();
    const target = localShellTarget({ client, events });
    expect(target).toMatchObject({ plugin: HOST, id: 'local', title: 'Terminal' });
    expect(target.scope).toBeUndefined();
    expect(target.resource).toBeUndefined();
    expect(client.calls).toEqual([]);
    const feed = target.open();
    expect(client.calls).toEqual([]);
    feed.resize(132, 41);
    expect(client.calls.map((call) => call[0])).toEqual(['CreateTerminal']);
    expect(events.count()).toBe(4);
    void feed.close();
  });

  it('names its tab by the shell the host says it started, and by nothing before that: the title it was given stays until the producer names a program', () => {
    const { client, events } = rig();
    const target = localShellTarget({ client, events });
    expect(target.retitle?.({ state: 'starting' })).toBeUndefined();
    expect(target.retitle?.({ state: 'running' })).toBeUndefined();
    expect(target.retitle?.({ state: 'running', program: 'zsh' })).toBe('zsh');
    expect(target.retitle?.({ state: 'ended', program: 'bash', exit: { code: 0 } })).toBe('bash');
  });
});
