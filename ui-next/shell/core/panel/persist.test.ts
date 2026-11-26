import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../tabs/persist';
import { checkInvariants, createPanelSaver, createPanelStore, LIMITS, MIGRATIONS, PANEL_VERSION, restorePanel, RESTORED_CAUSE, serialise, type PersistedPanel } from './index';
import { boot, generator, session, tool } from './testing';

// The saved panel (ch16 S103, S105, S116, S150): versioned and migratable, repaired rather than discarded, one write per burst. Cases marked "mock" are ported from the design lab's harness
// (ShellStore2-unit.cjs "panel state persists per window and a bad value falls back to hidden (S105)", ShellStore/unit.cjs "persist: write after delay, only when changed, round trip, flush
// on demand" and "storage envelope and invalid data"); docs/ui-next/status/P1a.md lists which.
// The panel comes back as the person left it (T2d, decision A23). S103 saves its `open`, its height, its tool and the session of each tool, and S116 says "Sessions restored at startup, adopted from another window, or re-created by Retry
// do not open it (today's quiet-tab rule)": a restored session opens no panel, and a panel the person left open is not a session. A terminal that is alive again after a reload must not wait unseen behind a panel that was open.

const NOW = 5_000_000;
const restore = (raw: unknown) => restorePanel(raw, { now: NOW });

const saved = (extra: Partial<PersistedPanel> = {}): PersistedPanel => ({ version: 1, open: false, height: null, tool: null, active: {}, sessions: [], ...extra });
const entry = (id: string, toolId = 'logs', extra: Record<string, unknown> = {}) => ({ id, tool: toolId, plugin: 'acme', title: id, scope: '', ...extra });

describe('what the session saves', () => {
  it('is the version, the choices and the identity of each session: never its state or its output', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'worker', { scope: 'dev', route: { plugin: 'acme', contribution: 'item', params: { name: 'worker' } } }));
    h.store.setSessionState('s1', { state: 'running' });
    h.store.resize({ size: 333 });
    expect(h.store.serialise()).toEqual({
      version: 1,
      open: true,
      height: 333,
      tool: 'logs',
      active: { logs: 's1' },
      sessions: [{ id: 's1', tool: 'logs', plugin: 'acme', title: 'worker', scope: 'dev', route: { plugin: 'acme', contribution: 'item', params: { name: 'worker' } } }],
    });
    const text = JSON.stringify(h.store.serialise());
    for (const word of ['running', 'since', 'cause', 'mounted', 'tools', 'live']) {
      expect(text).not.toContain(word);
    }
  });

  it('is plain JSON that survives a round trip, and says its version first', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'worker'));
    const document = h.store.serialise();
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    expect(Object.keys(document)[0]).toBe('version');
  });

  it('keeps the newest sessions only: a plugin that is never installed again must not keep its sessions for ever', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [] } });
    for (let i = 0; i < LIMITS.persistedSessions + 10; i += 1) {
      h.store.openSession(session('logs', 'acme', `s-${String(i)}`));
    }

    const document = h.store.serialise();
    expect(document.sessions).toHaveLength(LIMITS.persistedSessions);
    expect(document.sessions[0]?.title).toBe('s-10');
    expect(document.sessions.at(-1)?.title).toBe(`s-${String(LIMITS.persistedSessions + 9)}`);
    expect(Object.values(document.active).every((id) => document.sessions.some((one) => one.id === id))).toBe(true);
  });
});

describe('the name a person gave a session', () => {
  it('is saved with the session, only for a session they named, and read back as theirs', () => {
    const h = boot({ hostTools: [tool('terminal', 'Terminal', 20)], plugins: { acme: [] } });
    h.store.openSession(session('terminal', 'acme', 'zsh'));
    h.store.openSession(session('terminal', 'acme', 'bash'));
    h.store.renameSession('s1', 'my build');
    const document = h.store.serialise();
    expect(document.sessions[0]).toMatchObject({ title: 'my build', titlePinned: true });
    expect(document.sessions[1]).not.toHaveProperty('titlePinned');
    const back = restore(JSON.parse(JSON.stringify(document)));
    expect(back.ok && back.state.sessions.s1).toMatchObject({ title: 'my build', titlePinned: true });
    expect(back.ok && back.state.sessions.s2).not.toHaveProperty('titlePinned');
  });

  it('is repaired when it is not the one value it can be: a flag that is not `true` is the owner\'s naming', () => {
    for (const bad of [false, 'yes', 1, null, {}]) {
      const back = restore(saved({ sessions: [entry('a', 'terminal', { titlePinned: bad })] }));
      expect(back.ok && back.state.sessions.a).not.toHaveProperty('titlePinned');
    }
  });
});

describe('a session that is read back', () => {
  it('has the choices it was saved with, open as it was left, and the sessions all ended: a panel that was open comes back open whatever it holds (T2d)', () => {
    const result = restore(saved({ open: true, height: 300, tool: 'logs', active: { logs: 'b' }, sessions: [entry('a'), entry('b', 'logs', { scope: 'dev' })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { state } = result;
    // Nothing is registered yet, so there is no tool to show and no body is mounted: the bodies come with the tools.
    expect(state).toMatchObject({ open: true, height: 300, tool: 'logs', active: { logs: 'b' }, order: ['a', 'b'], mounted: [] });
    expect(state.sessions.a).toMatchObject({ state: 'ended', since: NOW, cause: RESTORED_CAUSE, title: 'a', plugin: 'acme' });
    expect(state.sessions.b?.scope).toBe('dev');
    expect(checkInvariants(state)).toEqual([]);
    expect(result.repaired).toBe(false);
  });

  it('stays closed when it was left closed, whatever it holds: the person hid it, and a restored session opens nothing', () => {
    const result = restore(saved({ open: false, height: 300, tool: 'logs', active: { logs: 'b' }, sessions: [entry('a'), entry('b', 'logs', { scope: 'dev' })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state).toMatchObject({ open: false, height: 300, tool: 'logs', active: { logs: 'b' }, order: ['a', 'b'], mounted: [] });
    expect(result.state.sessions.b).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE });
    expect(checkInvariants(result.state)).toEqual([]);
    expect(result.repaired).toBe(false);

    // And it stays closed when its tool and its plugin arrive: a hidden panel shows nothing and mounts nothing.
    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('logs', 'Logs', 20));
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.getSnapshot()).toMatchObject({ open: false, mounted: [] });
    expect(store.selectors.shown(store.getSnapshot())).toBeNull();
  });

  it('comes back as it was left when it holds no session: open stays open and closed stays closed', () => {
    expect(restore(saved({ open: true, tool: 'logs' }))).toMatchObject({ ok: true, state: { open: true, tool: 'logs' } });
    expect(restore(saved({ open: false, tool: 'logs' }))).toMatchObject({ ok: true, state: { open: false, tool: 'logs' } });
  });

  it('opens for an open flag that is a yes and for nothing else: any other value in the document is a closed panel', () => {
    for (const open of ['true', 1, {}, [], null]) {
      const result = restore({ ...saved({ sessions: [entry('a')] }), open });
      expect(result.ok && result.state.open, JSON.stringify(open)).toBe(false);
    }
  });

  it('puts back the tool the panel was on and the session each tool was on, not the first of each: it opens on what it showed', () => {
    const result = restore(
      saved({
        open: true,
        tool: 'terminal',
        active: { terminal: 'z2', logs: 'l2' },
        sessions: [entry('l1', 'logs'), entry('z1', 'terminal', { plugin: 'host' }), entry('l2', 'logs'), entry('z2', 'terminal', { plugin: 'host' })],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state).toMatchObject({ open: true, tool: 'terminal', active: { terminal: 'z2', logs: 'l2' } });
    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('terminal', 'Terminal', 10));
    store.registerTool(tool('logs', 'Logs', 20));
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const state = store.getSnapshot();
    expect(store.selectors.shown(state)).toEqual({ tool: 'terminal', session: 'z2' });
    expect(store.selectors.activeSession(state, 'terminal')).toBe('z2');
    expect(store.selectors.activeSession(state, 'logs')).toBe('l2');
    // Only the body on screen is mounted: the others are mounted when they are first shown.
    expect(state.mounted).toEqual(['z2']);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('shows what an open panel shows while the plugin of its tool has not loaded, and never a body that is mounted and cannot be seen: its own tool and session are back with the plugin', () => {
    const result = restore(saved({ open: true, tool: 'acme:streams', active: { 'acme:streams': 'r1', logs: 'l1' }, sessions: [entry('r1', 'acme:streams'), entry('l1', 'logs')] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const store = createPanelStore({ initial: result.state });
    const sound = (): void => {
      expect(checkInvariants(store.getSnapshot())).toEqual([]);
    };

    // Before anything is registered the panel is open and has nothing to show: no tool, so no body.
    expect(store.getSnapshot()).toMatchObject({ open: true, tool: 'acme:streams', mounted: [] });
    expect(store.selectors.shown(store.getSnapshot())).toBeNull();
    sound();

    // The host's own tool comes first: the panel is on the first tool it has, the saved choice stands, and the sessions of a plugin that is not here are neither listed nor mounted.
    store.registerTool(tool('logs', 'Logs', 20));
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: null });
    expect(store.getSnapshot()).toMatchObject({ open: true, tool: 'acme:streams', mounted: [] });
    sound();

    // The plugin loads: its tool and its sessions return together, and the panel is on the tool and the session it was saved on.
    store.syncPlugins([{ id: 'acme', tools: [tool('streams', 'Streams', 30)] }]);
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'acme:streams', session: 'r1' });
    expect(store.getSnapshot().mounted).toEqual(['r1']);
    expect(store.selectors.activeSession(store.getSnapshot(), 'logs')).toBe('l1');
    sound();

    // And the plugin leaves again: what it brought goes with it, the session it had in the host's tool is held, and no body of its own stays mounted.
    store.syncPlugins([]);
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: 'l1' });
    expect(store.getSnapshot().mounted).toEqual(['l1']);
    sound();
  });

  it('is an open panel like any other once it is read: hiding it unmounts nothing, and showing it again puts back the tool and the session it was on', () => {
    const result = restore(saved({ open: true, tool: 'logs', active: { logs: 'b' }, sessions: [entry('a'), entry('b')] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('logs', 'Logs', 20));
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.getSnapshot().mounted).toEqual(['b']);
    store.hide();
    expect(store.getSnapshot()).toMatchObject({ open: false, mounted: ['b'] });
    expect(store.selectors.shown(store.getSnapshot())).toBeNull();
    store.show();
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: 'b' });
    expect(checkInvariants(store.getSnapshot())).toEqual([]);
  });

  it('is not moved by a session that is added without being revealed, as the host adds a terminal it finds that no saved tab held: the panel stays on the tool and the session it was saved on', () => {
    const result = restore(saved({ open: true, tool: 'terminal', active: { terminal: 'z2' }, sessions: [entry('z1', 'terminal', { plugin: 'host' }), entry('z2', 'terminal', { plugin: 'host' })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('terminal', 'Terminal', 10));
    store.registerTool(tool('logs', 'Logs', 20));
    store.openSession({ id: 'z3', tool: 'terminal', plugin: 'host', title: 'found' }, { reveal: false });
    store.openSession({ id: 'l1', tool: 'logs', plugin: 'host', title: 'found too' }, { reveal: false });
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'terminal', session: 'z2' });
    expect(store.getSnapshot()).toMatchObject({ open: true, tool: 'terminal', active: { terminal: 'z2' }, mounted: ['z2'] });
    expect(checkInvariants(store.getSnapshot())).toEqual([]);
  });

  it('has no tool and no plugin live: they are the host\'s to register again, and a restored session shows when its plugin has loaded', () => {
    const result = restore(saved({ sessions: [entry('a')] }));
    expect(result.ok && result.state.live).toEqual([]);
    if (!result.ok) {
      return;
    }

    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('logs', 'Logs', 20));
    expect(store.selectors.sessionIds(store.getSnapshot(), 'logs')).toEqual([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.selectors.sessionIds(store.getSnapshot(), 'logs')).toEqual(['a']);
    expect(store.getSnapshot().sessions.a?.state).toBe('ended');
  });

  it('round-trips what the store saved, open or closed', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'worker', { scope: 'dev', route: { plugin: 'acme', contribution: 'item', params: { n: '1' } } }));
    h.store.openSession(session('logs', 'acme', 'other'));
    h.store.activateSession('s1');
    h.store.resize({ size: 410 });
    const open = h.store.serialise();
    h.store.hide();
    const closed = h.store.serialise();
    expect([open.open, closed.open]).toEqual([true, false]);
    for (const first of [open, closed]) {
      const result = restore(JSON.parse(JSON.stringify(first)));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(serialise(result.state)).toEqual(first);
      }
    }
  });

  it('saves a retitled session with its new title and reads it back with it, the scope and the choices as they were', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'Terminal', { scope: 'dev', state: 'running' }));
    h.store.openSession(session('logs', 'acme', 'other'));
    h.store.retitleSession('s1', '  zsh ');
    const first = h.store.serialise();
    expect(first.sessions.map((one) => one.title)).toEqual(['zsh', 'other']);
    expect(first.sessions[0]).toMatchObject({ id: 's1', scope: 'dev' });
    const result = restore(JSON.parse(JSON.stringify(first)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(false);
      expect(result.state.sessions.s1).toMatchObject({ title: 'zsh', scope: 'dev', state: 'ended' });
      expect(serialise(result.state)).toEqual(first);
    }
  });
});

// A21: what a plugin's unload ended in a tool of the host is held, listed and readable until its tab closes. Held is a fact of this run: the panel saves what a session IS (its identity), never what it was doing or
// what it had read, so a session that is held when the app quits is saved as every other session is, and comes back as every restored session does.
describe('a session that its plugin\'s unload ended, and the saved panel (A21)', () => {
  const held = () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)], plugins: { acme: [], beta: [] } });
    h.store.openSession(session('logs', 'acme', 'follows', { scope: 'dev', state: 'running', route: { plugin: 'acme', contribution: 'item', params: { name: 'worker' } } }));
    h.store.openSession(session('logs', 'beta', 'stays', { state: 'running' }));
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    return h;
  };

  it('is saved as every session is: its identity, with no mark that it is held, no state, no cause and no line', () => {
    const h = held();
    expect(h.snapshot().sessions.s1).toMatchObject({ held: true, state: 'ended' });
    const document = h.store.serialise();
    expect(document.sessions).toEqual([
      { id: 's1', tool: 'logs', plugin: 'acme', title: 'follows', scope: 'dev', route: { plugin: 'acme', contribution: 'item', params: { name: 'worker' } } },
      { id: 's2', tool: 'logs', plugin: 'beta', title: 'stays', scope: '' },
    ]);
    const text = JSON.stringify(document);
    for (const word of ['held', 'ended', 'cause', 'since', 'unloaded']) {
      expect(text).not.toContain(word);
    }
  });

  it('comes back as a session of the last run does: ended with the words of a restart, not held, with no lines, hidden until its plugin has loaded, and then like any session of the host\'s tool', () => {
    const result = restore(JSON.parse(JSON.stringify(held().store.serialise())));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.sessions.s1).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE, since: NOW });
    expect(result.state.sessions.s1?.held).toBeUndefined();
    expect(result.state.live).toEqual([]);
    const store = createPanelStore({ initial: result.state });
    store.registerTool(tool('logs', 'Logs', 20));
    expect(store.selectors.sessionIds(store.getSnapshot(), 'logs')).toEqual([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.selectors.sessionIds(store.getSnapshot(), 'logs')).toEqual(['s1']);
    expect(store.getSnapshot().sessions.s1?.held).toBeUndefined();
    // Once its plugin has loaded it is a session of the host's tool like any other: when the plugin leaves it stays as it was, with the words of the restart (A21: whatever the state).
    store.syncPlugins([]);
    expect(store.selectors.sessionIds(store.getSnapshot(), 'logs')).toEqual(['s1']);
    expect(store.getSnapshot().sessions.s1).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE, held: true });
    expect(checkInvariants(store.getSnapshot())).toEqual([]);
  });

  it('is not made held by a document that says it is: the flag is not read', () => {
    const result = restore({ ...saved(), sessions: [{ ...entry('a'), held: true, state: 'running', cause: 'because' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.sessions.a).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE });
    expect(result.state.sessions.a?.held).toBeUndefined();
    expect(result.repaired).toBe(false);
    expect(checkInvariants(result.state)).toEqual([]);
  });
});

describe('a saved panel that is damaged is repaired, not discarded (mock: "a bad value falls back to hidden")', () => {
  it('falls back to a hidden panel, with the tool and the height it can read', () => {
    const result = restore({ version: 1, open: 'sideways', height: 'tall', tool: 5, active: 'x', sessions: 'nope' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toMatchObject({ open: false, height: null, tool: null, active: {}, order: [] });
      expect(result.repaired).toBe(true);
      expect(result.problems.length).toBeGreaterThan(0);
    }
  });

  it('drops a session alone: one with no id, one with no title, one that is not an object, a repeated id, a route that is nonsense', () => {
    const result = restore({ ...saved(), sessions: [entry('a'), { tool: 'logs' }, entry('b', 'logs', { title: '  ' }), 7, entry('a', 'logs', { title: 'again' }), entry('c', 'logs', { route: { plugin: 'acme' } })] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.order).toEqual(['a', 'c']);
    expect(result.state.sessions.a?.title).toBe('a');
    expect(result.state.sessions.c?.route).toBeUndefined();
    expect(result.repaired).toBe(true);
    expect(result.problems).toHaveLength(5);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it('drops an active session that is not one of its tool\'s sessions', () => {
    const result = restore(saved({ active: { logs: 'zzz', terminal: 'a' }, sessions: [entry('a', 'logs')] }));
    expect(result.ok && result.state.active).toEqual({});
  });

  it('clamps a height below the minimum and refuses a nonsense one', () => {
    expect((restore(saved({ height: 40 })) as { state: { height: number } }).state.height).toBe(120);
    for (const height of [-5, 0, Number.NaN, 'x', {}]) {
      const result = restore({ ...saved(), height });
      expect(result.ok && result.state.height).toBe(null);
    }
  });

  it('clamps a height to the window it is read in when it is told the window (mock: "clamped to window height - 312" on load), and to the minimum only when it is not', () => {
    expect(restorePanel(saved({ height: 5000 }), { now: NOW, viewport: 900 })).toMatchObject({ ok: true, state: { height: 588 } });
    expect(restorePanel(saved({ height: 5000 }), { now: NOW, viewport: 400 })).toMatchObject({ ok: true, state: { height: 120 } });
    expect(restorePanel(saved({ height: 300 }), { now: NOW, viewport: 900 })).toMatchObject({ ok: true, state: { height: 300 } });
    expect(restorePanel(saved({ height: null }), { now: NOW, viewport: 900 })).toMatchObject({ ok: true, state: { height: null } });
    expect(restore(saved({ height: 5000 }))).toMatchObject({ ok: true, state: { height: 5000 } });
  });

  it('keeps a tool id and a plugin id whole, however long: they are identifiers, only the words a person reads are cut (CodeRabbit, sessions.ts:40)', () => {
    const tool = `tool-${'t'.repeat(245)}`;
    const plugin = `plugin-${'p'.repeat(243)}`;
    const result = restore(saved({ sessions: [{ id: 'a', tool, plugin, title: 'x'.repeat(300), scope: '' }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.sessions.a?.tool).toBe(tool);
    expect(result.state.sessions.a?.plugin).toBe(plugin);
    expect(result.state.sessions.a?.title).toHaveLength(LIMITS.text);
  });

  it('reads a session whose id is a name every object has (`constructor`, `__proto__`) as the session it is: an own entry, in the order, with its choice kept', () => {
    const document = JSON.parse(
      JSON.stringify(saved({ tool: 'logs', active: { logs: '__proto__' }, sessions: [entry('constructor'), entry('__proto__'), entry('toString', 'terminal')] })),
    ) as unknown;
    const result = restore(document);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.repaired).toBe(false);
    expect(result.state.order).toEqual(['constructor', '__proto__', 'toString']);
    expect(Object.keys(result.state.sessions)).toEqual(['constructor', '__proto__', 'toString']);
    expect(Object.keys(result.state.active)).toEqual(['logs']);
    expect(result.state.active.logs).toBe('__proto__');
    expect(checkInvariants(result.state)).toEqual([]);
    // And what it saves again is what it read.
    expect(serialise(result.state)).toEqual(saved({ tool: 'logs', active: { logs: '__proto__' }, sessions: [entry('constructor'), entry('__proto__'), entry('toString', 'terminal')] }));
  });

  it('does not take a session named `constructor` for a repeat of another: nothing has been read yet', () => {
    const result = restore(saved({ sessions: [entry('constructor')] }));
    expect(result.ok && result.state.order).toEqual(['constructor']);
    expect(result.ok && result.repaired).toBe(false);
  });

  it('never throws, and always starts sound, whatever it is given (a fuzz of damaged documents)', () => {
    const base = saved({ open: true, height: 300, tool: 'logs', active: { logs: 'a' }, sessions: [entry('a'), entry('b', 'terminal', { route: { plugin: 'acme', contribution: 'item', params: { n: 1 } } })] });
    const mutate = (value: unknown, seed: number): unknown => {
      const next = generator(seed);

      const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) {
          const copy = node.map(walk);
          if (next() % 7 === 0) {
            copy.splice(next() % (copy.length + 1), 1);
          }

          return copy;
        }

        if (node !== null && typeof node === 'object') {
          const copy: Record<string, unknown> = {};
          for (const [key, item] of Object.entries(node)) {
            const roll = next() % 11;
            if (roll === 0) {
              continue;
            }

            copy[key] = roll === 1 ? [null, 0, '', {}, 'x', -1, true][next() % 7] : walk(item);
          }

          return copy;
        }

        return node;
      };

      return walk(value);
    };

    for (let seed = 1; seed <= 600; seed += 1) {
      const damaged = mutate(base, seed);
      const result = restore(damaged);
      if (result.ok) {
        expect(checkInvariants(result.state), `seed ${String(seed)}`).toEqual([]);
        // The panel is open exactly when the document says it is (T2d), whatever else of it was damaged: sessions dropped or kept, a tool or a height that cannot be read.
        const says = typeof damaged === 'object' && damaged !== null && 'open' in damaged && damaged.open === true;
        expect(result.state.open, `seed ${String(seed)}: the open flag`).toBe(says);
      }
    }
  });

  it('says why when there is nothing to read: nothing saved, not a document, a newer version', () => {
    expect(restore(undefined)).toMatchObject({ ok: false, reason: 'missing' });
    expect(restore(null)).toMatchObject({ ok: false, reason: 'missing' });
    expect(restore('garbage{')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restore([1])).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restore({ open: true })).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restore({ ...saved(), version: PANEL_VERSION + 1 })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(restore({ ...saved(), version: 0 })).toMatchObject({ ok: false, reason: 'foreign-version' });
  });
});

describe('migration', () => {
  it('has no step at version 1: the first release has nothing to migrate from', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('brings an older document up one version at a time (a model with a version 3 and two steps)', () => {
    const steps = {
      1: (value: Record<string, unknown>) => ({ ...value, version: 2, height: value.size ?? null }),
      2: (value: Record<string, unknown>) => ({ ...value, version: 3, tool: value.tool ?? null }),
    };
    expect(migrate({ version: 1, size: 280 }, { current: 3, steps })).toEqual({ ok: true, version: 3, value: { version: 3, size: 280, height: 280, tool: null } });
    expect(migrate({ version: 3 }, { current: 3, steps })).toMatchObject({ ok: true, version: 3 });
    expect(migrate({ version: 1 }, { current: 3, steps: { 1: steps[1] } })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(migrate({ version: 1 }, { current: 2, steps: { 1: () => ({ version: 5 }) } })).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});

describe('writing it (HLT-36: one write per burst, flushed when the window closes)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ten changes inside 400 ms make one write, 400 ms after the last', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)] });
    const writes: PersistedPanel[] = [];
    createPanelSaver({ store: h.store, write: (value) => writes.push(value) });
    for (let i = 0; i < 10; i += 1) {
      h.store.resize({ size: 200 + i });
      if (i < 9) {
        vi.advanceTimersByTime(30);
      }
    }

    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(399);
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.height).toBe(209);
  });

  it('writes nothing for a change that saves the same document (hiding and showing a panel with no session, the toolbar\'s state)', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)] });
    const writes: PersistedPanel[] = [];
    createPanelSaver({ store: h.store, write: (value) => writes.push(value) });
    h.store.show();
    vi.advanceTimersByTime(400);
    expect(writes).toHaveLength(1);
    h.store.hide();
    h.store.show();
    vi.advanceTimersByTime(400);
    expect(writes).toHaveLength(1);
  });

  it('flush writes what is pending at once, and nothing when nothing is pending', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)] });
    const writes: PersistedPanel[] = [];
    const saver = createPanelSaver({ store: h.store, write: (value) => writes.push(value) });
    saver.flush();
    expect(writes).toHaveLength(0);
    h.store.resize({ size: 333 });
    saver.flush();
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
  });

  it('dispose stops listening and drops what is pending', () => {
    const h = boot({ hostTools: [tool('logs', 'Logs', 20)] });
    const writes: PersistedPanel[] = [];
    const saver = createPanelSaver({ store: h.store, write: (value) => writes.push(value) });
    h.store.resize({ size: 301 });
    saver.dispose();
    h.store.resize({ size: 302 });
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(0);
  });
});
