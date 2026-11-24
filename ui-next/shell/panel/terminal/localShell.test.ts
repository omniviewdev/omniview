import { describe, expect, it, vi } from 'vitest';
import { HOST } from '../../core/panel';
import { attachLocalTerminal, localShellTarget, localShellTransport, restoreLocalTerminals, type ExecClientLike, type EventsLike } from './localShell';

// The host's own shell as a feed: `ExecClient.CreateTerminal` starts the user's login shell on a pty of this machine (backend/pkg/terminal/manager.go), and the session is read and written through the exec lane's
// events and calls. What is tested here is the mapping of the feed's transport onto the binding, as it is: the call and its arguments, the call number of an input call (the feed's, passed on as it is: the host
// orders the calls by it), the order of rows and columns, the events of a session, and what an error of the backend is called.

type Rig = {
  readonly client: ExecClientLike & { readonly calls: Array<readonly [string, ...unknown[]]> };
  readonly events: EventsLike & { readonly emit: (name: string, data: unknown) => void; readonly count: () => number };
};

type RigOptions = {
  /** What `ListTerminals` answers. Default: none listed. */
  readonly listed?: unknown;
  /** What `AttachTerminal` answers. Default: nothing. */
  readonly attached?: unknown;
  /** `ListTerminals` is refused. */
  readonly listFails?: Error;
};

function rig(options: RigOptions = {}): Rig {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const listeners = new Map<string, Set<(event: { readonly data: unknown }) => void>>();
  const client = {
    calls,
    CreateTerminal: async (opts: unknown, launch: unknown) => {
      calls.push(['CreateTerminal', opts, launch]);
      return Promise.resolve(null);
    },
    ListTerminals: async (pageKey: string) => {
      calls.push(['ListTerminals', pageKey]);
      if (options.listFails !== undefined) {
        throw options.listFails;
      }

      return Promise.resolve(options.listed ?? []);
    },
    AttachTerminal: async (id: string, request: unknown) => {
      calls.push(['AttachTerminal', id, request]);
      return Promise.resolve(options.attached ?? null);
    },
    DetachTerminal: async (id: string, request: unknown) => {
      calls.push(['DetachTerminal', id, request]);
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

// ---- T2b: a terminal that outlives its page (docs/ui-next/status/T2-go.md) ---------------------------------------------------------------------------------------------------------------------------------

const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** What `AttachTerminal` answers (`terminal.Attached`): the terminal's replay, the number of this attachment, the shell, and the number the terminal's input queue takes next (host #675: at least 1 for a terminal that runs). */
const attachedAnswer = (name = 'zsh', nextInputSeq = 1): Record<string, unknown> => ({
  session: { id: 'term-1', pid: 4242, shell: { path: `/bin/${name}`, name }, cwd: '/home/u', cols: 80, rows: 24, lease_ms: 300_000 },
  replay: {
    start: 0,
    end: 5,
    data: btoa('hello'),
    start_size: { cols: 80, rows: 24 },
    start_modes: { known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] },
    size: { cols: 80, rows: 24 },
    modes: { known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] },
  },
  cwd: { path: '/home/u' },
  busy: { state: 'idle' },
  attachment: 1,
  next_input_seq: nextInputSeq,
});

const listedTerminal = (id: string, name?: string): Record<string, unknown> => ({ id, created_at: '2026-11-23T10:00:00Z', pid: 4242, shell: name === undefined ? {} : { path: `/bin/${name}`, name }, labels: {}, params: {}, size: { cols: 80, rows: 24 }, attached: false, next_offset: 5, replay_start: 0, next_input_seq: 1, lease_expires_unix_ms: 1 });

describe('the transport of the host\'s own shell, for a terminal that outlives its page', () => {
  it('gives the page key and the lease to the call that starts the terminal as `page_key` and `lease_ms`, beside the size, and nothing else of them when they are not given', async () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    await transport.create('term-1', { cols: 132, rows: 41 }, { pageKey: KEY });
    await transport.create('term-2', { cols: 132, rows: 41 }, { pageKey: KEY, leaseMs: 600_000 });
    await transport.create('term-3', { cols: 132, rows: 41 }, {});
    await transport.create('term-4', { cols: 132, rows: 41 });
    const launches = client.calls.map((call) => call[2]);
    expect(launches).toStrictEqual([{ cols: 132, rows: 41, page_key: KEY }, { cols: 132, rows: 41, page_key: KEY, lease_ms: 600_000 }, { cols: 132, rows: 41 }, { cols: 132, rows: 41 }]);
  });

  it('lists the terminals of a page key with the one call, by the key, and hands back the host\'s own answer', async () => {
    const listed = [listedTerminal('a', 'zsh')];
    const { client, events } = rig({ listed });
    await expect(localShellTransport({ client, events }).list(KEY)).resolves.toBe(listed);
    expect(client.calls).toEqual([['ListTerminals', KEY]]);
  });

  it('takes a terminal over by its id with the key as `page_key`, and asks for NO offset when it is given none: a fresh emulator has nothing', async () => {
    const answer = attachedAnswer();
    const { client, events } = rig({ attached: answer });
    await expect(localShellTransport({ client, events }).attach('term-1', { pageKey: KEY })).resolves.toBe(answer);
    expect(client.calls).toEqual([['AttachTerminal', 'term-1', { page_key: KEY }]]);
    expect(client.calls[0]?.[2]).toStrictEqual({ page_key: KEY });
  });

  it('says the offset when there is one, as `from_offset`, and zero is an offset: the page that has rendered nothing of what it keeps asks from the start', async () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    await transport.attach('term-1', { pageKey: KEY, fromOffset: 4_096 });
    await transport.attach('term-1', { pageKey: KEY, fromOffset: 0 });
    expect(client.calls.map((call) => call[2])).toStrictEqual([{ page_key: KEY, from_offset: 4_096 }, { page_key: KEY, from_offset: 0 }]);
  });

  it('detaches a terminal by its id with the key as `page_key`, and no lease of its own: the terminal\'s lease applies', async () => {
    const { client, events } = rig();
    await localShellTransport({ client, events }).detach('term-1', { pageKey: KEY });
    expect(client.calls).toEqual([['DetachTerminal', 'term-1', { page_key: KEY }]]);
    expect(client.calls[0]?.[2]).toStrictEqual({ page_key: KEY });
  });

  it('does not make the call before it is made: the calls are in the tick they are asked, in the order, as the input calls are', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    void transport.list(KEY);
    void transport.attach('term-1', { pageKey: KEY });
    void transport.detach('term-1', { pageKey: KEY });
    expect(client.calls.map((call) => call[0])).toEqual(['ListTerminals', 'AttachTerminal', 'DetachTerminal']);
  });

  it('reads the shells the host tried from the typed refusal, in its order, as tokens and not words: a list of where each came from, its path, why it was not used, and the system\'s words for `other`', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const tried = [
      { source: 'requested', path: '/opt/bin/fish', reason: 'not-found' },
      { source: 'environment', path: '/usr/local/bin/zsh', reason: 'not-executable' },
      { source: 'account', path: '/etc/shells/zsh', reason: 'not-a-shell' },
      { source: 'fallback', path: '/bin/sh', reason: 'other', detail: 'permission denied' },
    ];
    const refusal = new Error(JSON.stringify({ type: 'omniview:terminal/shell-unavailable', title: 'Shell not found', status: 422, detail: 'shell executable unavailable', code: 'SHELL_UNAVAILABLE', tried }));
    expect(transport.triedOf(refusal)).toEqual(tried);
  });

  it('hands over a token the runtime does not know as the runtime read it (it reads it as `other`), and says nothing for a refusal that lists nothing, or is no refusal of the host', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const odd = new Error(JSON.stringify({ type: 'omniview:terminal/shell-unavailable', title: 'Shell not found', status: 422, detail: 'x', code: 'SHELL_UNAVAILABLE', tried: [{ source: 'a-source-from-the-future', path: '/x/sh', reason: 'a-reason-from-the-future' }] }));
    expect(transport.triedOf(odd)).toEqual([{ source: 'other', path: '/x/sh', reason: 'other' }]);
    const none = new Error(JSON.stringify({ type: 'omniview:session/failed', title: 'Session failed', status: 500, detail: 'Failed to start terminal' }));
    expect(transport.triedOf(none)).toBeUndefined();
    expect(transport.triedOf(new Error('plain'))).toBeUndefined();
  });

  it('knows the host\'s answer for a session it does not have in the envelope the wire gives, a 422 whose message is the typed problem and whose cause has its fields: the answer to the close of a terminal that ended, which the host does not dismiss', () => {
    const { client, events } = rig();
    const transport = localShellTransport({ client, events });
    const problem = { type: 'omniview:session/not-found', title: 'Session not found', status: 404, detail: 'Session \'term-1\' was not found.' };
    expect(transport.isGone({ message: JSON.stringify(problem), cause: problem, kind: 'RuntimeError' })).toBe(true);
    expect(transport.isGone(Object.assign(new Error(JSON.stringify(problem)), { cause: problem, kind: 'RuntimeError' }))).toBe(true);
    const other = { type: 'omniview:terminal/input-backlog', title: 'Terminal input backlog', status: 429, detail: 'Send it again later.', code: 'INPUT_BACKLOG' };
    expect(transport.isGone({ message: JSON.stringify(other), cause: other, kind: 'RuntimeError' })).toBe(false);
  });
});

describe('the target of a terminal that outlives its page', () => {
  it('opens a keyed feed under the terminal\'s own id, and says that id: the panel session that shows it has the id of the terminal, so that a saved tab finds its terminal again', () => {
    const { client, events } = rig();
    const target = localShellTarget({ client, events }, KEY);
    expect(typeof target.sessionId).toBe('string');
    expect(target.sessionId).not.toBe('');
    expect(target).toMatchObject({ plugin: HOST, id: 'local', title: 'Terminal' });
    const feed = target.open();
    feed.resize(132, 41);
    expect(client.calls).toEqual([['CreateTerminal', { id: target.sessionId, tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, { cols: 132, rows: 41, page_key: KEY }]]);
    // The three events of a keyed terminal: its output with offsets, its end, and the loss of it.
    expect(events.count()).toBe(3);
    void feed.close();
  });

  it('makes a new terminal for each target, with an id of its own', () => {
    const { client, events } = rig();
    const ids = new Set([localShellTarget({ client, events }, KEY).sessionId, localShellTarget({ client, events }, KEY).sessionId, localShellTarget({ client, events }, KEY).sessionId]);
    expect(ids.size).toBe(3);
  });

  it('has no id and gives no key when it is not given a key: it is the terminal of T2a, which ends with its window', () => {
    const { client, events } = rig();
    const target = localShellTarget({ client, events });
    expect(target.sessionId).toBeUndefined();
    const feed = target.open();
    feed.resize(132, 41);
    expect(client.calls[0]?.[2]).toStrictEqual({ cols: 132, rows: 41 });
    expect(events.count()).toBe(4);
    void feed.close();
  });

  it('is named as the terminal of T2a is, by the shell the host says it started', () => {
    const { client, events } = rig();
    const target = localShellTarget({ client, events }, KEY);
    expect(target.retitle?.({ state: 'starting' })).toBeUndefined();
    expect(target.retitle?.({ state: 'running', program: 'zsh' })).toBe('zsh');
  });
});

describe('the terminals a page finds again after a reload', () => {
  it('lists the terminals of the page\'s key and makes a target for each, in the order the host gave them: the session id is the terminal\'s id, the title is its shell, and the tab is named as any other is', async () => {
    const { client, events } = rig({ listed: [listedTerminal('a', 'zsh'), listedTerminal('b', 'bash'), listedTerminal('c')] });
    const targets = await restoreLocalTerminals(KEY, { client, events });
    expect(client.calls).toEqual([['ListTerminals', KEY]]);
    expect(targets.map((target) => [target.sessionId, target.title, target.plugin, target.id])).toEqual([
      ['a', 'zsh', HOST, 'local'],
      ['b', 'bash', HOST, 'local'],
      ['c', 'Terminal', HOST, 'local'],
    ]);
    expect(targets[0]?.retitle?.({ state: 'running', program: 'zsh' })).toBe('zsh');
    expect(targets[0]?.scope).toBeUndefined();
    expect(targets[0]?.resource).toBeUndefined();
    // Nothing is attached until a target is opened: the host's terminals are not touched by a listing.
    expect(events.count()).toBe(0);
  });

  it('offers nothing when the host lists nothing: after the host restarted its terminals are gone, and a tab that was saved stays what it was', async () => {
    const { client, events } = rig();
    await expect(restoreLocalTerminals(KEY, { client, events })).resolves.toEqual([]);
  });

  it('says a terminal ended when the host lists how it ended, and leaves `ended` out of the target of one that runs: the registry gives an ended terminal only to a saved tab that still holds its id', async () => {
    const ended = { reason: 'exited', exit_code: 7, last_offset: 208 };
    const { client, events } = rig({ listed: [listedTerminal('a', 'zsh'), { ...listedTerminal('b', 'bash'), ended }, { ...listedTerminal('c', 'zsh'), ended: null }] });
    const targets = await restoreLocalTerminals(KEY, { client, events });
    expect(targets.map((target) => target.sessionId)).toEqual(['a', 'b', 'c']);
    expect(targets[0]).not.toHaveProperty('ended');
    expect(targets[1]).toHaveProperty('ended', true);
    expect(targets[2]).not.toHaveProperty('ended');
  });

  it('closes the tab of an ended terminal although the host will not dismiss it: its close answers not-found on the wire (a 422 whose cause is the typed problem) and the terminal stays listed until its lease runs out, so the close is done, and says nothing', async () => {
    const problem = { type: 'omniview:session/not-found', title: 'Session not found', status: 404, detail: 'Session \'a\' was not found.' };
    const end = { reason: 'exited', exit_code: 7, last_offset: 5 };
    const { client, events } = rig({ listed: [{ ...listedTerminal('a', 'zsh'), ended: end }], attached: { ...attachedAnswer('zsh', 0), ended: end } });
    client.CloseSession = async (id: string) => {
      client.calls.push(['CloseSession', id]);
      return Promise.reject(Object.assign(new Error(JSON.stringify(problem)), { cause: problem, kind: 'RuntimeError' }));
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [target] = await restoreLocalTerminals(KEY, { client, events });
    expect(target).toHaveProperty('ended', true);
    const feed = target?.open();
    await vi.waitFor(() => {
      expect(feed?.getSnapshot().state).toBe('ended');
    });
    expect(feed?.getSnapshot()).toEqual({ state: 'ended', exit: { code: 7 }, program: 'zsh' });
    await expect(feed?.close()).resolves.toBeUndefined();
    expect(client.calls.filter((call) => call[0] === 'CloseSession')).toEqual([['CloseSession', 'a']]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('opens a feed that takes the terminal over: it listens to the three events first, makes the one call that attaches it with the key and no offset, starts no process, and is the terminal once the host has answered', async () => {
    const { client, events } = rig({ listed: [listedTerminal('a', 'zsh')], attached: attachedAnswer('zsh') });
    const [target] = await restoreLocalTerminals(KEY, { client, events });
    expect(target).toBeDefined();
    const feed = target?.open();
    expect(events.count()).toBe(3);
    expect(client.calls.slice(1)).toEqual([['AttachTerminal', 'a', { page_key: KEY }]]);
    expect(client.calls[1]?.[2]).toStrictEqual({ page_key: KEY });
    expect(feed?.getSnapshot()).toEqual({ state: 'starting', program: 'zsh' });
    await vi.waitFor(() => {
      expect(feed?.getSnapshot().state).toBe('running');
    });
    expect([...(feed?.takeReplay?.()?.data ?? [])]).toEqual([...new TextEncoder().encode('hello')]);
    expect(client.calls.map((call) => call[0])).not.toContain('CreateTerminal');
    void feed?.close();
  });

  it('continues the count of the terminal\'s input from the number the answer to the attach states, and not from the one the listing stated: the first write has exactly that number on the binding, and the next call the next', async () => {
    const { client, events } = rig({ listed: [{ ...listedTerminal('a', 'zsh'), next_input_seq: 12 }], attached: attachedAnswer('zsh', 17) });
    const [target] = await restoreLocalTerminals(KEY, { client, events });
    const feed = target?.open();
    await vi.waitFor(() => {
      expect(feed?.getSnapshot().state).toBe('running');
    });
    feed?.write('a');
    feed?.write('b');
    expect(client.calls.filter((call) => call[0] === 'WriteTerminal')).toEqual([
      ['WriteTerminal', 'a', 17, btoa('a')],
      ['WriteTerminal', 'a', 18, btoa('b')],
    ]);
    void feed?.close();
  });

  it('fails the feed in the host\'s words when the host refuses to hand the terminal over, and never starts a process in its place', async () => {
    const { client, events } = rig({ listed: [listedTerminal('a', 'zsh')] });
    client.AttachTerminal = async () => Promise.reject(new Error(JSON.stringify({ type: 'omniview:session/not-found', title: 'Session not found', status: 404, detail: 'Session a not found' })));
    const [target] = await restoreLocalTerminals(KEY, { client, events });
    const feed = target?.open();
    await vi.waitFor(() => {
      expect(feed?.getSnapshot().state).toBe('failed');
    });
    expect(feed?.getSnapshot().cause).toEqual({ stage: 'start', message: 'Session a not found' });
    expect(events.count()).toBe(0);
  });

  it('says why when the host refuses to list: the call fails with the host\'s error, for the page to say, and nothing is guessed', async () => {
    const { client, events } = rig({ listFails: new Error('Forbidden') });
    await expect(restoreLocalTerminals(KEY, { client, events })).rejects.toThrow('Forbidden');
  });
});

describe('the target of one terminal the page takes over (`attachLocalTerminal`, T2d: take it back)', () => {
  it('is the target of that terminal: the session id is its id, the title is its shell (`Terminal` when it names none), the tab is named as any other is, and nothing is said of how it ended', () => {
    const { client, events } = rig();
    const named = attachLocalTerminal(KEY, 'a', 'zsh', { client, events });
    expect(named).toMatchObject({ plugin: HOST, id: 'local', title: 'zsh', sessionId: 'a' });
    expect(named.retitle?.({ state: 'running', program: 'bash' })).toBe('bash');
    expect(named.scope).toBeUndefined();
    expect(named.resource).toBeUndefined();
    expect(named).not.toHaveProperty('ended');
    expect(attachLocalTerminal(KEY, 'b', undefined, { client, events })).toMatchObject({ title: 'Terminal', sessionId: 'b' });
    // Making a target touches nothing.
    expect(client.calls).toEqual([]);
    expect(events.count()).toBe(0);
  });

  it('opens a feed that takes the terminal over, each time it is opened: it listens to the three events first, makes the one call that attaches it with the key and no offset, and starts no process', () => {
    const { client, events } = rig();
    const target = attachLocalTerminal(KEY, 'a', 'zsh', { client, events });
    const feed = target.open();
    expect(events.count()).toBe(3);
    expect(client.calls).toEqual([['AttachTerminal', 'a', { page_key: KEY }]]);
    expect(client.calls[0]?.[2]).toStrictEqual({ page_key: KEY });
    expect(feed.getSnapshot()).toEqual({ state: 'starting', program: 'zsh' });
    const again = target.open();
    expect(client.calls.filter((call) => call[0] === 'AttachTerminal')).toHaveLength(2);
    expect(again).not.toBe(feed);
    expect(client.calls.map((call) => call[0])).not.toContain('CreateTerminal');
    void feed.close();
    void again.close();
  });

  it('is the target that `restoreLocalTerminals` builds for each listed terminal, with `ended` added for one the host lists as ended', async () => {
    const ended = { reason: 'exited', exit_code: 7, last_offset: 5 };
    const { client, events } = rig({ listed: [listedTerminal('a', 'zsh'), { ...listedTerminal('b'), ended }] });
    const targets = await restoreLocalTerminals(KEY, { client, events });
    for (const [index, id, program] of [[0, 'a', 'zsh'], [1, 'b', undefined]] as const) {
      const built = attachLocalTerminal(KEY, id, program, { client, events });
      expect(targets[index]).toMatchObject({ plugin: built.plugin, id: built.id, title: built.title, sessionId: built.sessionId });
      expect(targets[index]?.retitle).toBe(built.retitle);
    }

    expect(targets[0]).not.toHaveProperty('ended');
    expect(targets[1]).toHaveProperty('ended', true);
  });
});
