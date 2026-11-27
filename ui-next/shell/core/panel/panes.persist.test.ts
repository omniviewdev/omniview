import { describe, expect, it } from 'vitest';
import { LAYOUT_MIGRATIONS, restorePanel, serialise } from './persist';
import { checkInvariants } from './state';
import { boot, session, tool, type Harness } from './testing';
import type { PersistedPanel } from './types';

// The saved panes (#697 step 6): the ratios live in the saved session next to the sessions they lay out. The panel's version stays 1 and a document that has no panes is exactly what was saved before them;
// the layout has a version of its own, so that it can change without moving the panel's. An old window loads as it always did, and a layout that cannot be read costs the layout and nothing else.

const EXTENT = 1000;
const HOST_TOOLS = [tool('terminal', 'Terminal', 10), tool('logs', 'Logs', 20)];

function terminalWith(count: number): Harness {
  const h = boot({ hostTools: HOST_TOOLS });
  h.store.openSession(session('terminal', 'host', 'shell 1', { state: 'running' }));
  for (let i = 2; i <= count; i += 1) {
    h.store.splitPane('terminal', { plugin: 'host', title: `shell ${String(i)}` }, { extent: EXTENT });
  }

  return h;
}

const restore = (raw: unknown) => restorePanel(raw, { now: 9000 });
const entry = (id: string, toolId = 'terminal') => ({ id, tool: toolId, plugin: 'host', title: id, scope: '' });
const layoutOf = (sessions: readonly string[], ratios: readonly number[], extra: Record<string, unknown> = {}) => ({ version: 1, tools: { terminal: { axis: 'row', sessions, ratios, active: 0, ...extra } } });
const withLayout = (layout: unknown, ids: readonly string[] = ['a', 'b', 'c']): Record<string, unknown> => ({
  version: 1,
  open: true,
  height: null,
  tool: 'terminal',
  active: {},
  sessions: ids.map((id) => entry(id)),
  layout,
});

describe('what the session saves of panes', () => {
  it('is nothing for a panel with no group: the document is what it was before panes, version 1, and has no layout at all', () => {
    const h = terminalWith(1);
    const document = h.store.serialise();
    expect(Object.keys(document)).toEqual(['version', 'open', 'height', 'tool', 'active', 'sessions']);
    expect(document.version).toBe(1);
    expect('layout' in document).toBe(false);
  });

  it('is, for a tool with panes, its sessions in order, its shares and the index of its active pane, under a layout of its own version', () => {
    const h = terminalWith(3);
    h.store.moveSash('terminal', 0, 0.125, EXTENT);
    h.store.focusPane('terminal', 'p2');
    const document = h.store.serialise();
    expect(document.version).toBe(1);
    expect(Object.keys(document)[0]).toBe('version');
    expect(document.layout).toEqual({ version: 1, tools: { terminal: { axis: 'row', sessions: ['s1', 's2', 's3'], ratios: h.snapshot().panes.terminal?.ratios, active: 1 } } });
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    expect(JSON.stringify(document)).not.toContain('"p1"');
  });

  it('comes back whole: the same sessions in the same panes with the same shares and the same pane active, and saves the same again', () => {
    const h = terminalWith(3);
    h.store.moveSash('terminal', 0, 0.125, EXTENT);
    h.store.focusPane('terminal', 'p2');
    const document = JSON.parse(JSON.stringify(h.store.serialise())) as PersistedPanel;
    const restored = restore(document);
    expect(restored).toMatchObject({ ok: true, repaired: false, problems: [] });
    if (!restored.ok) {
      return;
    }

    const group = restored.state.panes.terminal;
    expect(group?.panes.map((one) => one.session)).toEqual(['s1', 's2', 's3']);
    expect(group?.ratios).toEqual(h.snapshot().panes.terminal?.ratios);
    expect(group?.panes.find((one) => one.id === group.active)?.session).toBe('s2');
    expect(restored.state.active.terminal).toBe('s2');
    expect(checkInvariants(restored.state)).toEqual([]);
    expect(serialise(restored.state)).toEqual(document);
    for (const id of ['s1', 's2', 's3']) {
      expect(restored.state.sessions[id]?.state).toBe('ended');
    }
  });

  it('can be split again after it comes back: the slots are numbered from where the saved ones end', () => {
    const h = terminalWith(2);
    const restored = restore(JSON.parse(JSON.stringify(h.store.serialise())));
    if (!restored.ok) {
      throw new Error('not readable');
    }

    const again = boot({ hostTools: HOST_TOOLS, initial: restored.state });
    expect(again.store.splitPane('terminal', { plugin: 'host', title: 'shell 3' }, { extent: EXTENT })).toMatchObject({ status: 'done' });
    expect(new Set(again.snapshot().panes.terminal?.panes.map((one) => one.id)).size).toBe(3);
    expect(checkInvariants(again.snapshot())).toEqual([]);
  });
});

describe('a window saved before panes', () => {
  const old = {
    version: 1,
    open: true,
    height: 333,
    tool: 'terminal',
    active: { terminal: 'b' },
    sessions: [entry('a'), entry('b'), entry('c', 'logs')],
  };

  it('loads as it always did: no panes, nothing repaired, and it saves the same document', () => {
    const restored = restore(JSON.parse(JSON.stringify(old)));
    expect(restored).toMatchObject({ ok: true, repaired: false, problems: [] });
    if (!restored.ok) {
      return;
    }

    expect(restored.state.panes).toEqual({});
    expect(restored.state.active).toEqual({ terminal: 'b' });
    expect(restored.state.order).toEqual(['a', 'b', 'c']);
    expect(checkInvariants(restored.state)).toEqual([]);
    expect(serialise(restored.state)).toEqual(old);
    expect('layout' in serialise(restored.state)).toBe(false);
  });

  it('is still a panel the model can split', () => {
    const restored = restore(old);
    if (!restored.ok) {
      throw new Error('not readable');
    }

    const h = boot({ hostTools: HOST_TOOLS, initial: restored.state });
    expect(h.store.splitPane('terminal', { plugin: 'host', title: 'd' }, { extent: EXTENT })).toMatchObject({ status: 'done' });
    expect(h.snapshot().panes.terminal?.panes.map((one) => one.session)).toEqual(['b', expect.any(String)]);
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('is not rejected for the missing layout: a document with no layout, an empty one, and a layout of no tools all read', () => {
    for (const layout of [undefined, { version: 1, tools: {} }]) {
      expect(restore({ ...old, layout }), JSON.stringify(layout)).toMatchObject({ ok: true, repaired: false });
    }
  });
});

describe('a tool named like a member of every object, saved after the cap cut its chosen session', () => {
  it('has its own entry in the document\'s active choices: the document is what a restore saves again', () => {
    const h = boot({ hostTools: [tool('__proto__', 'Proto', 10), tool('logs', 'Logs', 20)] });
    h.store.openSession(session('__proto__', 'host', 'one'), { reveal: false });
    h.store.splitPane('__proto__', { plugin: 'host', title: 'two' }, { extent: EXTENT });
    h.store.splitPane('__proto__', { plugin: 'host', title: 'three' }, { extent: EXTENT });
    h.store.focusPane('__proto__', 'p1');
    for (let i = 0; i < 48; i += 1) {
      h.store.openSession(session('logs', 'host', `log ${String(i)}`), { reveal: false });
    }

    const document = JSON.parse(JSON.stringify(h.store.serialise())) as PersistedPanel;
    expect(document.sessions[0]?.id).toBe('s2');
    expect(Object.hasOwn(document.active, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(document.active)).__proto__).toBe('s3');
    const restored = restore(document);
    if (!restored.ok) {
      throw new Error('not readable');
    }

    expect(JSON.parse(JSON.stringify(serialise(restored.state)))).toEqual(document);
  });
});

describe('the layout\'s own migrations', () => {
  it('are a table of their own, empty at version 1', () => {
    expect(Object.keys(LAYOUT_MIGRATIONS)).toEqual([]);
  });

  it('an unknown version is dropped with the reason recorded, never read half way: newer, older with no step, not a whole number', () => {
    for (const version of [2, 0, 1.5, '1']) {
      const restored = restore(withLayout({ ...layoutOf(['a', 'b'], [0.5, 0.5]), version }));
      expect(restored, String(version)).toMatchObject({ ok: true, repaired: true });
      if (restored.ok) {
        expect(restored.state.panes).toEqual({});
        expect(restored.problems.some((one) => one.startsWith('the layout is dropped: ')), String(version)).toBe(true);
      }
    }
  });
});

describe('a layout that cannot be read', () => {
  it('costs the layout and nothing else: a layout of a newer version, or no object, loads the panel with one session per tool and says so', () => {
    for (const layout of [{ ...layoutOf(['a', 'b'], [0.5, 0.5]), version: 2 }, 'x', 5, [], { version: 1 }, { version: 1, tools: 'x' }]) {
      const restored = restore(withLayout(layout));
      expect(restored, JSON.stringify(layout)).toMatchObject({ ok: true, repaired: true });
      if (restored.ok) {
        expect(restored.state.panes, JSON.stringify(layout)).toEqual({});
        expect(restored.state.order).toEqual(['a', 'b', 'c']);
        expect(restored.problems.some((one) => one.startsWith('the layout')), JSON.stringify(layout)).toBe(true);
      }
    }
  });

  it('with shares that do not sum to 1, or are not one per pane, or are not above zero, makes the shares equal', () => {
    for (const ratios of [[0.5, 0.1], [0.9, 0.9], [0.5, 0.25, 0.25], [1], [1, 0], [1.5, -0.5], [Number.NaN, 1], ['a', 'b'], [0.5, null]]) {
      const restored = restore(withLayout(layoutOf(['a', 'b'], ratios as number[])));
      expect(restored, JSON.stringify(ratios)).toMatchObject({ ok: true, repaired: true });
      if (restored.ok) {
        expect(restored.state.panes.terminal?.ratios, JSON.stringify(ratios)).toEqual([0.5, 0.5]);
        expect(checkInvariants(restored.state), JSON.stringify(ratios)).toEqual([]);
      }
    }
  });

  it('drops a pane whose session is not saved, is of another tool, or is already in another pane, and shares its space in proportion', () => {
    const restored = restore(withLayout(layoutOf(['a', 'gone', 'a', 'c', 'b'], [0.1, 0.2, 0.1, 0.3, 0.3]), ['a', 'b', 'c']));
    expect(restored).toMatchObject({ ok: true, repaired: true });
    if (restored.ok) {
      const group = restored.state.panes.terminal;
      expect(group?.panes.map((one) => one.session)).toEqual(['a', 'c', 'b']);
      expect(group?.ratios.reduce((total, one) => total + one, 0)).toBeCloseTo(1, 12);
      expect(group?.ratios[0]).toBeCloseTo(0.1 / 0.7, 9);
      expect(checkInvariants(restored.state)).toEqual([]);
    }

    const other = restore({ ...withLayout(layoutOf(['a', 'x'], [0.5, 0.5]), ['a']), sessions: [entry('a'), entry('x', 'logs')] });
    expect(other).toMatchObject({ ok: true, repaired: true });
    if (other.ok) {
      expect(other.state.panes).toEqual({});
    }
  });

  it('with fewer than two panes left has no group, and a session is never in two groups', () => {
    for (const sessions of [[], ['a'], ['a', 'a'], ['zz', 'a']]) {
      const restored = restore(withLayout(layoutOf(sessions, sessions.map(() => 1 / Math.max(sessions.length, 1))), ['a', 'b']));
      expect(restored, JSON.stringify(sessions)).toMatchObject({ ok: true });
      if (restored.ok) {
        expect(restored.state.panes, JSON.stringify(sessions)).toEqual({});
        expect(checkInvariants(restored.state)).toEqual([]);
      }
    }
  });

  it('reads an axis it does not know as row, and an active index that is not a pane as the last pane', () => {
    const restored = restore(withLayout(layoutOf(['a', 'b', 'c'], [0.2, 0.3, 0.5], { axis: 'diagonal', active: 7 })));
    expect(restored).toMatchObject({ ok: true, repaired: true });
    if (restored.ok) {
      const group = restored.state.panes.terminal;
      expect(group?.axis).toBe('row');
      expect(group?.panes.find((one) => one.id === group.active)?.session).toBe('c');
      expect(restored.state.active.terminal).toBe('c');
      expect(checkInvariants(restored.state)).toEqual([]);
    }
  });

  it('takes the tool\'s saved active session when it is one of the panes: the saved choices agree', () => {
    const restored = restore({ ...withLayout(layoutOf(['a', 'b', 'c'], [0.2, 0.3, 0.5], { active: 0 })), active: { terminal: 'b' } });
    if (!restored.ok) {
      throw new Error('not readable');
    }

    expect(restored.state.active.terminal).toBe('b');
    expect(restored.state.panes.terminal?.panes.find((one) => one.id === restored.state.panes.terminal?.active)?.session).toBe('b');
    expect(checkInvariants(restored.state)).toEqual([]);
  });

  it('is read for a tool named like a member of every object, and for a tool the panel does not have', () => {
    // JSON, so that `__proto__` is a key of the document and not the prototype of an object literal.
    const layout: unknown = JSON.parse('{"version":1,"tools":{"constructor":{"axis":"row","sessions":["a","b"],"ratios":[0.5,0.5],"active":0},"__proto__":{"axis":"row"},"nothing":{"axis":"row","sessions":["a"],"ratios":[1],"active":0}}}');
    const restored = restore({ ...withLayout(layout, []), sessions: [entry('a', 'constructor'), entry('b', 'constructor')] });
    expect(restored).toMatchObject({ ok: true });
    if (restored.ok) {
      expect(Object.keys(restored.state.panes)).toEqual(['constructor']);
      expect(checkInvariants(restored.state)).toEqual([]);
    }
  });

  it('keeps only the panes whose sessions the saved panel keeps: past 50 sessions the oldest go, and a group left with one pane is gone', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'first'), { reveal: false });
    h.store.splitPane('terminal', { plugin: 'host', title: 'second' }, { extent: EXTENT });
    for (let i = 0; i < 60; i += 1) {
      h.store.openSession(session('logs', 'host', `log ${String(i)}`), { reveal: false });
    }

    expect(Object.keys(h.snapshot().panes)).toEqual(['terminal']);
    const document = h.store.serialise();
    expect(document.sessions).toHaveLength(50);
    expect(document.layout).toBeUndefined();
    const restored = restore(JSON.parse(JSON.stringify(document)));
    expect(restored).toMatchObject({ ok: true, repaired: false });
  });

  it('shares the space of a dropped pane among the others in the document itself: what is saved sums to 1', () => {
    const h = terminalWith(3);
    h.store.moveSash('terminal', 0, 0.125, EXTENT);
    for (let i = 0; i < 48; i += 1) {
      h.store.openSession(session('logs', 'host', `log ${String(i)}`), { reveal: false });
    }

    const document = h.store.serialise();
    expect(document.sessions).toHaveLength(50);
    expect(document.sessions[0]?.id).toBe('s2');
    const saved = document.layout?.tools.terminal;
    expect(saved?.sessions).toEqual(['s2', 's3']);
    expect(saved?.ratios.reduce((total, one) => total + one, 0)).toBeCloseTo(1, 12);
    const ratios = h.snapshot().panes.terminal?.ratios ?? [];
    expect(saved?.ratios[0]).toBeCloseTo(ratios[1] / (ratios[1] + ratios[2]), 12);
  });
});
