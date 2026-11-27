import { describe, expect, it } from 'vitest';
import { checkInvariants } from './state';
import { boot, session, tool, type Harness } from './testing';

// The panes of a tool (#697 step 6): a tool that shows several sessions at once. A tool with no group is the panel as it was, and every other test of this directory is that case.

const EXTENT = 1000;
const HOST_TOOLS = [tool('terminal', 'Terminal', 10), tool('logs', 'Logs', 20)];
const shell = (title: string, extra = {}) => ({ plugin: 'host', title, ...extra });

/** A panel whose Terminal tool shows `count` sessions, `s1` .. `s<count>`, side by side. The last is the active pane. */
function terminalWith(count: number): Harness {
  const h = boot({ hostTools: HOST_TOOLS });
  h.store.openSession(session('terminal', 'host', 'shell 1', { state: 'running' }));
  for (let i = 2; i <= count; i += 1) {
    expect(h.store.splitPane('terminal', shell(`shell ${String(i)}`, { state: 'running' }), { extent: EXTENT }).status).toBe('done');
  }

  return h;
}

const group = (h: Harness) => h.snapshot().panes.terminal;
const sessionsOf = (h: Harness): string[] => group(h)?.panes.map((one) => one.session) ?? [];
const sum = (list: readonly number[] | undefined): number => (list ?? []).reduce((total, one) => total + one, 0);

describe('a tool that shows one session', () => {
  it('has no group and one pane of the whole: the panel as it was', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')).toBeNull();
    h.store.openSession(session('terminal', 'host', 'shell 1'));
    expect(h.snapshot().panes).toEqual({});
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')).toEqual({ axis: 'row', panes: [{ id: 'p1', session: 's1' }], ratios: [1], active: 'p1' });
    h.store.openSession(session('terminal', 'host', 'shell 2'));
    h.store.closeSession('s2');
    expect(h.snapshot().panes).toEqual({});
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')?.panes).toEqual([{ id: 'p1', session: 's1' }]);
  });
});

describe('split', () => {
  it('opens a NEW session beside the active one: two panes, equal shares, the new pane active and shown', () => {
    const h = terminalWith(1);
    const before = h.snapshot();
    const result = h.store.splitPane('terminal', shell('shell 2'), { extent: EXTENT });
    expect(result).toEqual({ status: 'done', id: 's2', pane: 'p2' });
    const state = h.snapshot();
    expect(state.panes.terminal).toEqual({ axis: 'row', panes: [{ id: 'p1', session: 's1' }, { id: 'p2', session: 's2' }], ratios: [0.5, 0.5], active: 'p2', seq: 2 });
    expect(state.active.terminal).toBe('s2');
    expect(state.open).toBe(true);
    expect(state.tool).toBe('terminal');
    expect(state.order).toEqual(['s1', 's2']);
    expect(state.sessions.s1).toBe(before.sessions.s1);
    expect(state.sessions.s2).toMatchObject({ id: 's2', tool: 'terminal', plugin: 'host', title: 'shell 2', state: 'starting' });
    expect(state.mounted).toEqual(expect.arrayContaining(['s1', 's2']));
    expect(checkInvariants(state)).toEqual([]);
  });

  it('is never a copy: a session id that exists is refused and nothing changes; every split adds exactly one session', () => {
    const h = terminalWith(2);
    const before = h.snapshot();
    expect(h.store.splitPane('terminal', shell('again', { id: 's1' }), { extent: EXTENT })).toMatchObject({ status: 'refused', reason: 'taken' });
    expect(h.snapshot()).toBe(before);
    expect(h.store.splitPane('terminal', shell('shell 3'), { extent: EXTENT }).status).toBe('done');
    expect(Object.keys(h.snapshot().sessions)).toHaveLength(3);
    expect(sessionsOf(h)).toEqual(['s1', 's2', 's3']);
    expect(new Set(sessionsOf(h)).size).toBe(3);
  });

  it('puts the new pane after the ACTIVE pane, and gives every pane an equal share again', () => {
    const h = terminalWith(2);
    h.store.moveSash('terminal', 0, 0.2, EXTENT);
    h.store.focusPane('terminal', 'p1');
    expect(h.store.splitPane('terminal', shell('shell 3'), { extent: EXTENT })).toMatchObject({ status: 'done', id: 's3', pane: 'p3' });
    expect(sessionsOf(h)).toEqual(['s1', 's3', 's2']);
    expect(group(h)?.ratios).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(group(h)?.active).toBe('p3');
    expect(h.snapshot().active.terminal).toBe('s3');
  });

  it('on a tool that has no session opens one and makes no group', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.splitPane('terminal', shell('shell 1'), { extent: EXTENT })).toMatchObject({ status: 'done', id: 's1' });
    expect(h.snapshot().panes).toEqual({});
    expect(h.snapshot().active.terminal).toBe('s1');
  });

  it('is refused when the panes could not each have 80 px: the last that fits is extent / 80', () => {
    const h = terminalWith(1);
    expect(h.store.splitPane('terminal', shell('too many'), { extent: 150 })).toMatchObject({ status: 'refused', reason: 'full' });
    expect(Object.keys(h.snapshot().sessions)).toEqual(['s1']);
    expect(h.store.splitPane('terminal', shell('fits'), { extent: 160 }).status).toBe('done');
    expect(h.store.splitPane('terminal', shell('three'), { extent: 239 })).toMatchObject({ status: 'refused', reason: 'full' });
    expect(h.store.splitPane('terminal', shell('three'), { extent: 240 }).status).toBe('done');
    expect(h.store.splitPane('terminal', shell('four'), { extent: 319 })).toMatchObject({ status: 'refused', reason: 'full' });
    expect(group(h)?.panes).toHaveLength(3);
  });

  it('keeps ONE axis per tool (flat groups, as a terminal group is): another axis for a tool that has panes is refused, the same one or none is fine', () => {
    const h = terminalWith(1);
    expect(h.store.splitPane('terminal', shell('two'), { extent: EXTENT, axis: 'column' }).status).toBe('done');
    expect(group(h)?.axis).toBe('column');
    const before = h.snapshot();
    expect(h.store.splitPane('terminal', shell('three'), { extent: EXTENT, axis: 'row' })).toMatchObject({ status: 'refused', reason: 'axis' });
    expect(h.snapshot()).toBe(before);
    expect(h.store.splitPane('terminal', shell('three'), { extent: EXTENT, axis: 'column' }).status).toBe('done');
    expect(h.store.splitPane('terminal', shell('four'), { extent: EXTENT }).status).toBe('done');
    expect(group(h)?.axis).toBe('column');
  });

  it('is refused for a tool that is not there, a plugin that is not live, and a session with no title', () => {
    const h = terminalWith(1);
    const before = h.snapshot();
    expect(h.store.splitPane('nothing', shell('x'), { extent: EXTENT })).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.splitPane('terminal', { plugin: 'acme', title: 'x' }, { extent: EXTENT })).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.splitPane('terminal', shell('  '), { extent: EXTENT })).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.splitPane('terminal', shell('x'), { extent: Number.NaN })).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.snapshot()).toBe(before);
  });

  it('leaves the other tools alone', () => {
    const h = terminalWith(1);
    h.store.openSession(session('logs', 'host', 'log 1'));
    h.store.activateTool('terminal');
    h.store.splitPane('terminal', shell('shell 2'), { extent: EXTENT });
    expect(h.snapshot().panes.logs).toBeUndefined();
    expect(h.snapshot().active.logs).toBe('s2');
  });
});

describe('the active pane', () => {
  it('is chosen by focusPane: its session becomes the tool\'s active session; the same pane changes nothing, an unknown one is refused', () => {
    const h = terminalWith(3);
    expect(h.store.focusPane('terminal', 'p1')).toEqual({ status: 'done' });
    expect(group(h)?.active).toBe('p1');
    expect(h.snapshot().active.terminal).toBe('s1');
    const before = h.snapshot();
    expect(h.store.focusPane('terminal', 'p1')).toEqual({ status: 'noop' });
    expect(h.store.focusPane('terminal', 'p9')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.focusPane('logs', 'p1')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.snapshot()).toBe(before);
  });

  it('cannot be a pane whose session is hidden (its plugin is off): refused, and nothing changes', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('one', 'One', 30)], beta: [] } });
    h.store.openSession(session('acme:one', 'acme', 'a'));
    h.store.splitPane('acme:one', { plugin: 'beta', title: 'b' }, { extent: EXTENT });
    h.store.splitPane('acme:one', { plugin: 'acme', title: 'c' }, { extent: EXTENT });
    h.store.focusPane('acme:one', 'p1');
    h.store.syncPlugins([{ id: 'acme', tools: [tool('one', 'One', 30)] }]);
    const before = h.snapshot();
    expect(h.store.focusPane('acme:one', 'p2')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.snapshot()).toBe(before);
    expect(h.store.focusPane('acme:one', 'p3')).toMatchObject({ status: 'done' });
  });

  it('follows the session a tab chooses when that session is in a pane', () => {
    const h = terminalWith(3);
    h.store.activateSession('s2');
    expect(group(h)?.active).toBe('p2');
    expect(sessionsOf(h)).toEqual(['s1', 's2', 's3']);
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('takes a session that is in no pane into the active pane, and the session it had stays a tab: no session is ever in two panes', () => {
    const h = terminalWith(2);
    h.store.openSession(session('terminal', 'host', 'shell 3'), { reveal: false });
    expect(sessionsOf(h)).toEqual(['s1', 's2']);
    h.store.focusPane('terminal', 'p1');
    h.store.activateSession('s3');
    expect(sessionsOf(h)).toEqual(['s3', 's2']);
    expect(group(h)?.active).toBe('p1');
    expect(h.snapshot().active.terminal).toBe('s3');
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual(['s1', 's2', 's3']);
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('is where a session the user starts in the tool opens', () => {
    const h = terminalWith(2);
    h.store.openSession(session('terminal', 'host', 'shell 3'));
    expect(sessionsOf(h)).toEqual(['s1', 's3']);
    expect(group(h)?.active).toBe('p2');
    expect(h.snapshot().mounted).toContain('s3');
  });
});

describe('closing', () => {
  it('a session of a pane takes its pane with it and gives the share to the others in proportion', () => {
    const h = terminalWith(3);
    h.store.moveSash('terminal', 0, 0.2, EXTENT);
    h.store.moveSash('terminal', 1, 0.5, EXTENT);
    expect(group(h)?.ratios.map((one) => Math.round(one * 1000) / 1000)).toEqual([0.2, 0.3, 0.5]);
    h.store.focusPane('terminal', 'p1');
    expect(h.store.closeSession('s2')).toMatchObject({ status: 'done', closed: 's2' });
    expect(sessionsOf(h)).toEqual(['s1', 's3']);
    const ratios = group(h)?.ratios ?? [];
    expect(ratios[0]).toBeCloseTo(0.2 / 0.7, 9);
    expect(ratios[1]).toBeCloseTo(0.5 / 0.7, 9);
    expect(sum(ratios)).toBeCloseTo(1, 12);
    expect(group(h)?.active).toBe('p1');
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('the active pane passes the focus to the pane after it, else the one before', () => {
    const h = terminalWith(3);
    h.store.focusPane('terminal', 'p2');
    h.store.closeSession('s2');
    expect(group(h)?.active).toBe('p3');
    expect(h.snapshot().active.terminal).toBe('s3');
    const last = terminalWith(3);
    expect(group(last)?.active).toBe('p3');
    last.store.closeSession('s3');
    expect(group(last)?.active).toBe('p2');
    expect(last.snapshot().active.terminal).toBe('s2');
  });

  it('down to one pane dissolves the group: the survivor is the tool\'s session and the tool is as it was before the split', () => {
    const h = terminalWith(2);
    h.store.closeSession('s2');
    const state = h.snapshot();
    expect(state.panes).toEqual({});
    expect(state.active.terminal).toBe('s1');
    expect(h.store.selectors.paneLayout(state, 'terminal')).toMatchObject({ panes: [{ session: 's1' }], ratios: [1] });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('the last session leaves the tool with no pane and no group, as an empty tool was', () => {
    const h = terminalWith(2);
    h.store.closeSession('s2');
    expect(h.store.closeSession('s1')).toMatchObject({ status: 'done', closed: 's1', active: null });
    expect(h.snapshot().panes).toEqual({});
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')).toBeNull();
  });

  it('a session that is in no pane leaves the panes as they are', () => {
    const h = terminalWith(2);
    h.store.openSession(session('terminal', 'host', 'shell 3'), { reveal: false });
    const before = group(h);
    h.store.closeSession('s3');
    expect(group(h)).toBe(before);
  });

  it('a session of another tool leaves the panes as they are', () => {
    const h = terminalWith(2);
    h.store.openSession(session('logs', 'host', 'log 1'), { reveal: false });
    const before = group(h);
    h.store.closeSession('s3');
    expect(group(h)).toBe(before);
  });
});

describe('the ratios', () => {
  it('moveSash drags a border: the two panes beside it share what they had, the others do not move', () => {
    const h = terminalWith(3);
    expect(h.store.moveSash('terminal', 0, 0.2, EXTENT)).toEqual({ status: 'done' });
    const ratios = group(h)?.ratios ?? [];
    expect(ratios[0]).toBeCloseTo(0.2, 12);
    expect(ratios[1]).toBeCloseTo(1 / 3 + (1 / 3 - 0.2), 12);
    expect(ratios[2]).toBe(1 / 3);
    expect(sum(ratios)).toBeCloseTo(1, 12);
  });

  it('keeps every pane at 80 px or more of the extent: a drag past the minimum stops there', () => {
    const h = terminalWith(2);
    h.store.moveSash('terminal', 0, 0, 800);
    expect(group(h)?.ratios[0]).toBeCloseTo(0.1, 12);
    h.store.moveSash('terminal', 0, 1, 800);
    expect(group(h)?.ratios[1]).toBeCloseTo(0.1, 12);
    expect(h.store.moveSash('terminal', 0, 1, 800)).toEqual({ status: 'noop' });
  });

  it('refuses a tool with no group, a boundary that is not there and a position that is not a number', () => {
    const h = terminalWith(2);
    const before = h.snapshot();
    expect(h.store.moveSash('logs', 0, 0.3, EXTENT)).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.moveSash('terminal', 1, 0.3, EXTENT)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.moveSash('terminal', -1, 0.3, EXTENT)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.moveSash('terminal', 0, Number.NaN, EXTENT)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.moveSash('terminal', 0, 0.3, 0)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.snapshot()).toBe(before);
  });

  it('equalisePanes makes every share 1/n again (the sash\'s double click), and changes nothing when they are', () => {
    const h = terminalWith(4);
    expect(h.store.equalisePanes('terminal', EXTENT)).toEqual({ status: 'noop' });
    h.store.moveSash('terminal', 1, 0.6, EXTENT);
    expect(group(h)?.ratios).not.toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(h.store.equalisePanes('terminal', EXTENT)).toEqual({ status: 'done' });
    expect(group(h)?.ratios).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(h.store.equalisePanes('logs', EXTENT)).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('fitPanes brings shares within the minimum of the extent it is given, and keeps them so', () => {
    const h = terminalWith(2);
    h.store.moveSash('terminal', 0, 0.02, 10_000);
    expect(group(h)?.ratios[0]).toBeCloseTo(0.02, 12);
    expect(h.store.fitPanes('terminal', 800)).toEqual({ status: 'done' });
    expect(group(h)?.ratios[0]).toBeCloseTo(0.1, 12);
    expect(sum(group(h)?.ratios)).toBeCloseTo(1, 12);
    expect(h.store.fitPanes('terminal', 800)).toEqual({ status: 'noop' });
    expect(h.store.fitPanes('terminal', 100)).toEqual({ status: 'done' });
    expect(group(h)?.ratios).toEqual([0.5, 0.5]);
  });
});

describe('what a tool draws', () => {
  it('is its panes, shares and active pane, and the same object until one of them changes', () => {
    const h = terminalWith(3);
    const layout = h.store.selectors.paneLayout(h.snapshot(), 'terminal');
    expect(layout).toEqual({ axis: 'row', panes: [{ id: 'p1', session: 's1' }, { id: 'p2', session: 's2' }, { id: 'p3', session: 's3' }], ratios: [1 / 3, 1 / 3, 1 / 3], active: 'p3' });
    h.store.setSessionState('s1', { state: 'ended' });
    h.store.openSession(session('logs', 'host', 'log 1'), { reveal: false });
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')).toBe(layout);
    h.store.moveSash('terminal', 0, 0.2, EXTENT);
    expect(h.store.selectors.paneLayout(h.snapshot(), 'terminal')).not.toBe(layout);
  });

  it('leaves out a pane whose session is hidden (its plugin is off) and shares its space among the rest in proportion; the stored shares are not touched', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('one', 'One', 30)], beta: [] } });
    h.store.openSession(session('acme:one', 'acme', 'a'));
    h.store.splitPane('acme:one', { plugin: 'beta', title: 'b' }, { extent: EXTENT });
    h.store.splitPane('acme:one', { plugin: 'acme', title: 'c' }, { extent: EXTENT });
    h.store.moveSash('acme:one', 0, 0.1, EXTENT);
    h.store.moveSash('acme:one', 1, 0.5, EXTENT);
    const stored = h.snapshot().panes['acme:one']?.ratios;
    expect(stored?.[0]).toBeCloseTo(0.1, 12);
    h.store.syncPlugins([{ id: 'acme', tools: [tool('one', 'One', 30)] }]);
    const layout = h.store.selectors.paneLayout(h.snapshot(), 'acme:one');
    expect(layout?.panes.map((one) => one.session)).toEqual(['s1', 's3']);
    expect(layout?.ratios[0]).toBeCloseTo(0.1 / 0.6, 9);
    expect(layout?.ratios[1]).toBeCloseTo(0.5 / 0.6, 9);
    expect(h.snapshot().panes['acme:one']?.ratios).toBe(stored);
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('a group with one visible pane left is drawn as that one pane of the whole; with none, the tool draws nothing', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('one', 'One', 30)], beta: [] } });
    h.store.openSession(session('acme:one', 'acme', 'a'));
    h.store.splitPane('acme:one', { plugin: 'beta', title: 'b' }, { extent: EXTENT });
    h.store.syncPlugins([{ id: 'acme', tools: [tool('one', 'One', 30)] }]);
    expect(h.store.selectors.paneLayout(h.snapshot(), 'acme:one')).toMatchObject({ panes: [{ session: 's1' }], ratios: [1] });
    h.store.syncPlugins([]);
    expect(h.store.selectors.paneLayout(h.snapshot(), 'acme:one')).toBeNull();
  });
});
