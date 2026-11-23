import { describe, expect, it, vi } from 'vitest';
import { HOST } from '../../core/panel';
import { localShellTarget, localShellTransport, type ExecClientLike, type EventsLike } from './localShell';

// The host's own shell as a feed: `ExecClient.CreateTerminal` starts the user's login shell on a pty of this machine (backend/pkg/terminal/manager.go), and the session is read and written through the exec lane's
// events and calls. What is tested here is the mapping of the feed's transport onto the binding, as it is: the call and its arguments, the order of rows and columns, the events of a session, and what an error of the
// backend is called.

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
    WriteSession: async (id: string, data: string) => {
      calls.push(['WriteSession', id, data]);
      return Promise.resolve();
    },
    ResizeSession: async (id: string, rows: number, cols: number) => {
      calls.push(['ResizeSession', id, rows, cols]);
      return Promise.resolve();
    },
    CloseSession: async (id: string) => {
      calls.push(['CloseSession', id]);
      return Promise.resolve();
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

  it('writes, resizes and closes by the session\'s id, and takes rows BEFORE columns, as the binding does', async () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    await transport.write('term-1', 'bHM=');
    await transport.resize('term-1', 41, 132);
    await transport.close('term-1');
    expect(client.calls).toEqual([
      ['WriteSession', 'term-1', 'bHM='],
      ['ResizeSession', 'term-1', 41, 132],
      ['CloseSession', 'term-1'],
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
});
