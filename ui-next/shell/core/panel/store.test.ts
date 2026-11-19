import { describe, expect, it } from 'vitest';
import { checkInvariants } from './state';
import { boot, session, tool } from './testing';

// The panel's model, through its store: open and closed, the size that is remembered, the tools and which one is on screen, the sessions each tool holds and what a plugin leaving does
// to them. Cases marked "mock" are ported from the design lab's harness (tests/shell-model-harness: ShellStore/unit.cjs "persist: clamp on load and on resize", ShellStore2-unit.cjs "panel
// state persists per window and a bad value falls back to hidden (S105)" and "layout paths persist per window and plugin and clamp on a smaller window", ShellStore/unit.cjs
// "panelTools limit is 2") or from the rules of ch16 S105, S113 to S116 and PO1; docs/ui-next/status/P1a.md lists which.

const HOST_TOOLS = [tool('terminal', 'Terminal', 10), tool('logs', 'Logs', 20)];

describe('a new panel', () => {
  it('is hidden, has no tool, no session and the default height, and is sound', () => {
    const { snapshot } = boot();
    const state = snapshot();
    expect(state).toMatchObject({ version: 1, open: false, height: null, tool: null, order: [], mounted: [], live: [] });
    expect(Object.keys(state.tools)).toEqual([]);
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('open and closed', () => {
  it('show opens, hide closes, toggle does the other; an operation that changes nothing returns the same snapshot and tells nobody', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    const before = h.snapshot();
    expect(h.store.show()).toEqual({ status: 'done' });
    expect(h.snapshot().open).toBe(true);
    const open = h.snapshot();
    expect(h.store.show()).toEqual({ status: 'noop' });
    expect(h.snapshot()).toBe(open);
    expect(h.store.hide()).toEqual({ status: 'done' });
    expect(h.store.hide()).toEqual({ status: 'noop' });
    expect(h.store.toggle()).toEqual({ status: 'done' });
    expect(h.snapshot().open).toBe(true);
    expect(h.store.toggle()).toEqual({ status: 'done' });
    expect(h.snapshot().open).toBe(false);
    expect(before).not.toBe(h.snapshot());
    // show, hide, toggle, toggle: four changes; the two no-ops told nobody.
    expect(h.notified()).toBe(4);
  });

  it('show with a tool puts that tool on screen; a tool that does not exist opens the panel and leaves the choice alone', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.show({ tool: 'logs' });
    expect(h.snapshot().tool).toBe('logs');
    expect(h.store.selectors.shown(h.snapshot())).toEqual({ tool: 'logs', session: null });
    h.store.hide();
    h.store.show({ tool: 'nope' });
    expect(h.snapshot().open).toBe(true);
    expect(h.snapshot().tool).toBe('logs');
  });

  it('hiding forgets nothing: the height, the tool, the sessions and their bodies stay', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [] } });
    h.store.resize({ size: 333 });
    h.store.openSession(session('terminal', 'host', 'zsh'));
    const kept = h.snapshot();
    expect(kept.open).toBe(true);
    h.store.hide();
    const after = h.snapshot();
    expect(after.open).toBe(false);
    expect({ height: after.height, tool: after.tool, order: after.order, mounted: after.mounted }).toEqual({ height: 333, tool: kept.tool, order: kept.order, mounted: kept.mounted });
    expect(after.mounted).toEqual(['s1']);
  });
});

describe('the height (ch16 S99 to S103)', () => {
  it('remembers a size across hiding and showing, rounded to whole pixels', () => {
    const h = boot();
    expect(h.store.resize({ size: 300.4 })).toEqual({ status: 'done' });
    expect(h.snapshot().height).toBe(300);
    expect(h.store.resize({ size: 300.2 })).toEqual({ status: 'noop' });
    h.store.show();
    h.store.hide();
    expect(h.snapshot().height).toBe(300);
  });

  it('stores a size that is clamped below at the minimum (the window clamps it above, where it is drawn) and never a nonsense one', () => {
    const h = boot();
    h.store.resize({ size: 100 });
    expect(h.snapshot().height).toBe(120);
    h.store.resize({ size: 1e9 });
    expect(h.snapshot().height).toBe(10_000);
    const before = h.snapshot();
    expect(h.store.resize({ size: Number.NaN })).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.resize({ size: Number.POSITIVE_INFINITY })).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.snapshot()).toBe(before);
  });

  it('a release below the collapse threshold hides the panel and keeps the height it had (S101: one remembered size)', () => {
    const h = boot();
    h.store.show();
    h.store.resize({ size: 410 });
    expect(h.store.resize({ collapse: true })).toEqual({ status: 'done' });
    expect(h.snapshot()).toMatchObject({ open: false, height: 410 });
    expect(h.store.resize({ collapse: true })).toEqual({ status: 'noop' });
  });

  it('resetHeight returns to the default (the handle\'s double click and Enter)', () => {
    const h = boot();
    h.store.resize({ size: 410 });
    expect(h.store.resetHeight()).toEqual({ status: 'done' });
    expect(h.snapshot().height).toBeNull();
    expect(h.store.resetHeight()).toEqual({ status: 'noop' });
  });

  it('resizing a hidden panel stores the size and does not open it', () => {
    const h = boot();
    h.store.resize({ size: 250 });
    expect(h.snapshot()).toMatchObject({ open: false, height: 250 });
  });
});

describe('the tools of the host', () => {
  it('are listed in order, lowest first, and registration breaks a tie', () => {
    const h = boot();
    h.store.registerTool(tool('b', 'B', 20));
    h.store.registerTool(tool('a', 'A', 20));
    h.store.registerTool(tool('c', 'C', 5));
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['c', 'b', 'a']);
  });

  it('without an order sit after those that have one, in the order they registered', () => {
    const h = boot();
    h.store.registerTool(tool('late'));
    h.store.registerTool(tool('first', 'First', 1));
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['first', 'late']);
  });

  it('are refused when they are not valid data: no id, no label, no glyph, an id with a colon (that is how a plugin\'s tool id is made)', () => {
    const h = boot();
    for (const bad of [tool(''), { ...tool('x'), label: '  ' }, { ...tool('x'), icon: '' }, tool('a:b')]) {
      expect(h.store.registerTool(bad)).toMatchObject({ status: 'refused', reason: 'invalid' });
    }

    expect(h.store.selectors.toolIds(h.snapshot())).toEqual([]);
  });

  it('registering a tool again changes its words and keeps its place; the same words change nothing', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    const before = h.snapshot();
    expect(h.store.registerTool(tool('terminal', 'Terminal', 10))).toEqual({ status: 'noop' });
    expect(h.snapshot()).toBe(before);
    expect(h.store.registerTool({ ...tool('terminal', 'Shells', 10) })).toEqual({ status: 'done' });
    expect(h.store.selectors.toolItem(h.snapshot(), 'terminal')?.label).toBe('Shells');
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['terminal', 'logs']);
  });

  it('a plugin\'s tool cannot be taken over by the host registering its id, and the host\'s cannot be taken by a plugin', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('terminal')] } });
    // The plugin's tool is `acme:terminal`: a different id from the host's, so neither replaces the other.
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['terminal', 'logs', 'acme:terminal']);
    expect(h.snapshot().tools.terminal?.owner).toBe('host');
    expect(h.snapshot().tools['acme:terminal']?.owner).toBe('acme');
  });

  it('unregisterTool removes it; its sessions stay, hidden, and come back with it', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh'));
    expect(h.store.unregisterTool('terminal')).toEqual({ status: 'done' });
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['logs']);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual([]);
    expect(h.store.unregisterTool('terminal')).toMatchObject({ status: 'refused', reason: 'missing' });
    h.store.registerTool(tool('terminal', 'Terminal', 10));
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual(['s1']);
  });
});

describe('the tool on screen', () => {
  it('is the first tool while the user chose none', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('terminal');
    expect(h.snapshot().tool).toBeNull();
  });

  it('is the one the user chose; choosing a tool that does not exist is refused', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.activateTool('logs')).toEqual({ status: 'done' });
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('logs');
    expect(h.store.activateTool('logs')).toEqual({ status: 'noop' });
    expect(h.store.activateTool('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('choosing a tool does not open the panel: a tab is clicked in an open panel, and a command that opens one is show({ tool })', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.activateTool('logs');
    expect(h.snapshot().open).toBe(false);
  });

  it('falls back to the first visible tool when the chosen one goes away, and returns to the choice when it comes back', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('metrics', 'Metrics', 30)] } });
    h.store.activateTool('acme:metrics');
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('acme:metrics');
    h.store.syncPlugins([]);
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('terminal');
    expect(h.snapshot().tool).toBe('acme:metrics');
    h.store.syncPlugins([{ id: 'acme', tools: [tool('metrics', 'Metrics', 30)] }]);
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('acme:metrics');
  });

  it('is none while there is no tool at all (the panel then shows its empty state)', () => {
    const h = boot();
    h.store.show();
    expect(h.store.selectors.activeTool(h.snapshot())).toBeNull();
    expect(h.store.selectors.shown(h.snapshot())).toBeNull();
  });
});

describe('the tools a plugin brings (PO1: a plugin that is off contributes nothing)', () => {
  it('are prefixed with the plugin\'s id and owned by it', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('metrics', 'Metrics', 30)] } });
    expect(h.snapshot().tools['acme:metrics']).toMatchObject({ owner: 'acme', label: 'Metrics', order: 30 });
    expect(h.snapshot().live).toEqual(['acme']);
  });

  it('are withdrawn with the plugin, in the same transaction, and the host\'s stay', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('metrics', 'Metrics', 30)], beta: [tool('stream', 'Stream', 40)] } });
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['terminal', 'logs', 'acme:metrics', 'beta:stream']);
    let told = h.notified();
    h.store.syncPlugins([{ id: 'beta', tools: [tool('stream', 'Stream', 40)] }]);
    expect(h.notified()).toBe(told + 1);
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['terminal', 'logs', 'beta:stream']);
    expect(Object.keys(h.snapshot().tools)).not.toContain('acme:metrics');
    told = h.notified();
    expect(h.store.syncPlugins([{ id: 'beta', tools: [tool('stream', 'Stream', 40)] }])).toEqual({ status: 'noop' });
    expect(h.notified()).toBe(told);
  });

  it('a plugin that brings no tool is still live: its sessions in a host tool show', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'worker'));
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s1']);
  });

  it('change in place: a tool whose words change keeps its place and its sessions', () => {
    const h = boot({ plugins: { acme: [tool('metrics', 'Metrics', 30)] } });
    h.store.openSession(session('acme:metrics', 'acme', 'run'));
    h.store.syncPlugins([{ id: 'acme', tools: [tool('metrics', 'Measures', 30)] }]);
    expect(h.store.selectors.toolItem(h.snapshot(), 'acme:metrics')?.label).toBe('Measures');
    expect(h.store.selectors.sessionIds(h.snapshot(), 'acme:metrics')).toEqual(['s1']);
  });

  it('a tool with no valid id or words is left out and the rest of the plugin\'s tools are kept', () => {
    const h = boot({ plugins: { acme: [tool(''), tool('ok', 'Fine')] } });
    expect(Object.keys(h.snapshot().tools)).toEqual(['acme:ok']);
  });
});

describe('a session', () => {
  it('opens in a tool, starting, with the time it started, and the panel shows it', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [] } });
    const opened = h.store.openSession(session('logs', 'acme', 'worker-7d8c6f49b-f8q4m', { scope: 'dev' }));
    expect(opened).toEqual({ status: 'done', id: 's1' });
    expect(h.snapshot().sessions.s1).toMatchObject({ tool: 'logs', plugin: 'acme', title: 'worker-7d8c6f49b-f8q4m', scope: 'dev', state: 'starting', since: 1_000_000, cause: '' });
    expect(h.snapshot()).toMatchObject({ open: true, tool: 'logs', active: { logs: 's1' }, mounted: ['s1'] });
    expect(h.store.selectors.shown(h.snapshot())).toEqual({ tool: 'logs', session: 's1' });
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('does not open the panel when it is told not to (S116: a restored, adopted or retried session never covers the page)', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh'), { reveal: false });
    expect(h.snapshot()).toMatchObject({ open: false, tool: null, mounted: [] });
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual(['s1']);
  });

  it('opened with the panel already open on another tool takes that tool\'s place only when it is revealed', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.show({ tool: 'terminal' });
    h.store.openSession(session('logs', 'host', 'build'), { reveal: false });
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('terminal');
    expect(h.snapshot().mounted).toEqual([]);
    h.store.openSession(session('logs', 'host', 'deploy'));
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('logs');
    expect(h.store.selectors.activeSession(h.snapshot(), 'logs')).toBe('s2');
  });

  it('in a tool that is not there yet is kept, hidden, and does not open the panel', () => {
    const h = boot({ plugins: { acme: [] } });
    expect(h.store.openSession(session('logs', 'acme', 'worker'))).toEqual({ status: 'done', id: 's1' });
    expect(h.snapshot().open).toBe(false);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual([]);
    h.store.registerTool(tool('logs', 'Logs', 20));
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s1']);
  });

  it('is refused when it is not valid data, or its plugin is not live', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [] } });
    const before = h.snapshot();
    expect(h.store.openSession(session('logs', 'acme', '   '))).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.openSession(session('', 'acme', 'x'))).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.openSession(session('logs', '', 'x'))).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.openSession(session('logs', 'acme', 'x', { route: { plugin: 'acme' } }))).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.openSession(session('logs', 'gone', 'x'))).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.snapshot()).toBe(before);
  });

  it('keeps an id it is given, and refuses one that is taken', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.openSession(session('terminal', 'host', 'a', { id: 'mine' }))).toEqual({ status: 'done', id: 'mine' });
    expect(h.store.openSession(session('terminal', 'host', 'b', { id: 'mine' }))).toMatchObject({ status: 'refused', reason: 'taken' });
  });

  it('never gets an id another session has, even from a generator that repeats', () => {
    let calls = 0;
    const h = boot({ hostTools: HOST_TOOLS, newId: () => (calls++ < 3 ? 'same' : `fresh${String(calls)}`) });
    const a = h.store.openSession(session('terminal', 'host', 'a'));
    const b = h.store.openSession(session('terminal', 'host', 'b'));
    expect(a).toEqual({ status: 'done', id: 'same' });
    expect(b).toMatchObject({ status: 'done' });
    expect(b.status === 'done' && b.id).not.toBe('same');
  });

  it('keeps its words trimmed and cut at 200 characters, and its route canonical and frozen', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    const route = { plugin: 'acme', contribution: 'item', params: { z: '1', a: '2', empty: '' } };
    h.store.openSession(session('terminal', 'host', `  ${'x'.repeat(300)}  `, { scope: ' dev ', route }));
    const kept = h.snapshot().sessions.s1;
    expect(kept?.title).toBe('x'.repeat(200));
    expect(kept?.scope).toBe('dev');
    expect(kept?.route).toEqual({ plugin: 'acme', contribution: 'item', params: { a: '2', z: '1' } });
    expect(Object.keys(kept?.route?.params ?? {})).toEqual(['a', 'z']);
    expect(Object.isFrozen(kept)).toBe(true);
    expect(Object.isFrozen(kept?.route)).toBe(true);
    expect(route.params.z).toBe('1');
  });

  it('can open already ended or failed, with its cause (a session that could not start)', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a', { state: 'failed', cause: 'The source did not answer.' }));
    expect(h.snapshot().sessions.s1).toMatchObject({ state: 'failed', cause: 'The source did not answer.' });
    h.store.openSession(session('terminal', 'host', 'b', { state: 'running', cause: 'ignored while it runs' }));
    expect(h.snapshot().sessions.s2).toMatchObject({ state: 'running', cause: '' });
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('the strip lists the sessions of a tool in the order they were opened', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('logs', 'host', 'x'));
    h.store.openSession(session('terminal', 'host', 'b'));
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual(['s1', 's3']);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s2']);
  });
});

describe('what a session is doing', () => {
  it('moves from starting to running and on, and `since` moves only with the state', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.tick(5000);
    expect(h.store.setSessionState('s1', { state: 'running' })).toEqual({ status: 'done' });
    expect(h.snapshot().sessions.s1).toMatchObject({ state: 'running', since: 1_005_000 });
    h.tick(5000);
    expect(h.store.setSessionState('s1', { state: 'running' })).toEqual({ status: 'noop' });
    expect(h.snapshot().sessions.s1?.since).toBe(1_005_000);
  });

  it('a failure and an end carry their cause, and leaving them clears it (a retry reuses the slot: RM1)', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'), { reveal: false });
    h.store.setSessionState('s1', { state: 'failed', cause: 'Connection refused.' });
    expect(h.snapshot().sessions.s1).toMatchObject({ state: 'failed', cause: 'Connection refused.' });
    h.store.setSessionState('s1', { state: 'failed', cause: 'Connection refused.' });
    expect(h.store.setSessionState('s1', { state: 'failed', cause: 'Timed out.' })).toEqual({ status: 'done' });
    expect(h.snapshot().sessions.s1?.cause).toBe('Timed out.');
    h.store.setSessionState('s1', { state: 'starting' });
    expect(h.snapshot().sessions.s1).toMatchObject({ state: 'starting', cause: '' });
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('is refused for a session that is not there', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.setSessionState('nope', { state: 'running' })).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('a change of one session leaves every other session record the same object', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('terminal', 'host', 'b'));
    const other = h.snapshot().sessions.s2;
    h.store.setSessionState('s1', { state: 'running' });
    expect(h.snapshot().sessions.s2).toBe(other);
  });
});

describe('closing a session', () => {
  const three = () => {
    const h = boot({ hostTools: HOST_TOOLS });
    for (const title of ['a', 'b', 'c']) {
      h.store.openSession(session('terminal', 'host', title));
    }

    return h;
  };

  it('removes it, and the session on screen passes to the one after it, else the one before', () => {
    const h = three();
    h.store.activateSession('s2');
    expect(h.store.closeSession('s2')).toEqual({ status: 'done', closed: 's2', active: 's3' });
    expect(h.store.selectors.activeSession(h.snapshot(), 'terminal')).toBe('s3');
    expect(h.store.closeSession('s3')).toEqual({ status: 'done', closed: 's3', active: 's1' });
    expect(h.store.closeSession('s1')).toEqual({ status: 'done', closed: 's1', active: null });
    expect(h.snapshot().order).toEqual([]);
    expect(h.snapshot().active).toEqual({});
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('closing another session leaves the one on screen where it is', () => {
    const h = three();
    h.store.activateSession('s3');
    h.store.closeSession('s1');
    expect(h.store.selectors.activeSession(h.snapshot(), 'terminal')).toBe('s3');
  });

  it('unmounts its body, and no other', () => {
    const h = three();
    h.store.activateSession('s1');
    h.store.activateSession('s2');
    expect(h.snapshot().mounted).toEqual(['s1', 's2', 's3']);
    h.store.closeSession('s1');
    expect(h.snapshot().mounted).toEqual(['s2', 's3']);
  });

  it('is refused for a session that is not there, and the panel stays as it was', () => {
    const h = three();
    const before = h.snapshot();
    expect(h.store.closeSession('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.snapshot()).toBe(before);
  });

  it('leaves the panel open and the tool in place: an empty tool shows its empty state', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.closeSession('s1');
    expect(h.snapshot().open).toBe(true);
    expect(h.store.selectors.shown(h.snapshot())).toEqual({ tool: 'terminal', session: null });
  });
});

describe('choosing a session', () => {
  it('puts its tool on screen and the session on its strip; a session that is hidden or missing is refused', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('logs', 'host', 'x'));
    h.store.openSession(session('terminal', 'host', 'b'), { reveal: false });
    expect(h.store.activateSession('s3')).toEqual({ status: 'done' });
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('terminal');
    expect(h.store.selectors.activeSession(h.snapshot(), 'terminal')).toBe('s3');
    expect(h.store.activateSession('s3')).toEqual({ status: 'noop' });
    expect(h.store.activateSession('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('does not open the panel: a tab is clicked in an open panel', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'), { reveal: false });
    h.store.activateSession('s1');
    expect(h.snapshot().open).toBe(false);
    expect(h.snapshot().mounted).toEqual([]);
  });
});

describe('the body of a session (docs/ui-next/optimisations.md HLT-32, MNR-X4)', () => {
  it('is mounted when it is first shown, and stays while another is on screen and while the panel is hidden', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('terminal', 'host', 'b'));
    h.store.openSession(session('logs', 'host', 'x'));
    expect(h.store.selectors.mounted(h.snapshot())).toEqual(['s1', 's2', 's3']);
    h.store.activateTool('terminal');
    h.store.hide();
    expect(h.store.selectors.mounted(h.snapshot())).toEqual(['s1', 's2', 's3']);
  });

  it('is not mounted by a session that was opened and never shown, nor by a hidden panel', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'), { reveal: false });
    h.store.openSession(session('terminal', 'host', 'b'), { reveal: false });
    expect(h.store.selectors.mounted(h.snapshot())).toEqual([]);
    h.store.show();
    // The panel shows the first session of the tool.
    expect(h.store.selectors.mounted(h.snapshot())).toEqual(['s1']);
  });

  it('is listed in the order the sessions were opened, whatever order they were shown in', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'), { reveal: false });
    h.store.openSession(session('terminal', 'host', 'b'), { reveal: false });
    h.store.openSession(session('terminal', 'host', 'c'), { reveal: false });
    h.store.show();
    h.store.activateSession('s3');
    h.store.activateSession('s2');
    expect(h.snapshot().mounted).toEqual(['s1', 's3', 's2']);
    expect(h.store.selectors.mounted(h.snapshot())).toEqual(['s1', 's2', 's3']);
  });

  it('isShown is true for the one body on screen, and for none while the panel is hidden', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('terminal', 'host', 'b'));
    const { isShown } = h.store.selectors;
    expect([isShown(h.snapshot(), 's1'), isShown(h.snapshot(), 's2')]).toEqual([false, true]);
    h.store.hide();
    expect([isShown(h.snapshot(), 's1'), isShown(h.snapshot(), 's2')]).toEqual([false, false]);
  });
});

describe('a plugin that is unloaded (PO1, S114a)', () => {
  const world = () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('metrics', 'Metrics', 30)], beta: [] } });
    h.store.openSession(session('logs', 'acme', 'one'));
    h.store.openSession(session('logs', 'beta', 'two'));
    h.store.openSession(session('logs', 'host', 'mine'));
    h.store.openSession(session('acme:metrics', 'acme', 'run'));
    return h;
  };

  it('hides its sessions in the same transaction, and ends the ones that were running', () => {
    const h = world();
    h.store.setSessionState('s1', { state: 'running' });
    h.tick(2000);
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s2', 's3']);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'acme:metrics')).toEqual([]);
    expect(h.snapshot().sessions.s1).toMatchObject({ state: 'ended', since: 1_002_000 });
    expect(h.snapshot().sessions.s1?.cause).not.toBe('');
    // The session of another plugin and the host's own are not touched.
    expect(h.snapshot().sessions.s2?.state).toBe('starting');
    expect(h.snapshot().sessions.s3?.state).toBe('starting');
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });

  it('unmounts its bodies, and brings none back until they are shown again', () => {
    const h = world();
    expect(h.snapshot().mounted).toEqual(['s1', 's2', 's3', 's4']);
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(h.store.selectors.mounted(h.snapshot())).not.toContain('s1');
    expect(h.store.selectors.mounted(h.snapshot())).not.toContain('s4');
    h.store.syncPlugins([{ id: 'acme', tools: [tool('metrics', 'Metrics', 30)] }, { id: 'beta', tools: [] }]);
    expect(h.store.selectors.mounted(h.snapshot())).not.toContain('s1');
  });

  it('returns them with it, still ended: they stay ended until the user starts them again', () => {
    const h = world();
    h.store.setSessionState('s1', { state: 'running' });
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    h.store.syncPlugins([{ id: 'acme', tools: [tool('metrics', 'Metrics', 30)] }, { id: 'beta', tools: [] }]);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s1', 's2', 's3']);
    expect(h.snapshot().sessions.s1?.state).toBe('ended');
    expect(h.store.selectors.sessionIds(h.snapshot(), 'acme:metrics')).toEqual(['s4']);
  });

  it('cannot open a session while it is off', () => {
    const h = world();
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(h.store.openSession(session('logs', 'acme', 'late'))).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('puts the strip on the first visible session when the one on screen is hidden', () => {
    const h = world();
    h.store.activateSession('s1');
    expect(h.store.selectors.activeSession(h.snapshot(), 'logs')).toBe('s1');
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(h.store.selectors.activeSession(h.snapshot(), 'logs')).toBe('s2');
    h.store.syncPlugins([{ id: 'acme', tools: [tool('metrics', 'Metrics', 30)] }, { id: 'beta', tools: [] }]);
    expect(h.store.selectors.activeSession(h.snapshot(), 'logs')).toBe('s1');
  });
});

describe('twins in a strip (TI1, SCT1)', () => {
  it('two sessions with one name and one scope tell themselves apart by an ordinal, the first having none', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    for (let i = 0; i < 3; i += 1) {
      h.store.openSession(session('terminal', 'host', 'zsh'));
    }

    const items = h.store.selectors.sessionIds(h.snapshot(), 'terminal').map((id) => h.store.selectors.sessionItem(h.snapshot(), id));
    expect(items.map((item) => item?.name)).toEqual(['zsh', 'zsh (2)', 'zsh (3)']);
    expect(items.map((item) => item?.tail)).toEqual(['', ' (2)', ' (3)']);
  });

  it('a different scope is already a difference', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh', { scope: 'dev' }));
    h.store.openSession(session('terminal', 'host', 'zsh', { scope: 'prod' }));
    const items = h.store.selectors.sessionIds(h.snapshot(), 'terminal').map((id) => h.store.selectors.sessionItem(h.snapshot(), id));
    expect(items.map((item) => item?.name)).toEqual(['zsh · dev', 'zsh · prod']);
  });

  it('closing the first twin gives the next its name back', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh'));
    h.store.openSession(session('terminal', 'host', 'zsh'));
    h.store.closeSession('s1');
    expect(h.store.selectors.sessionItem(h.snapshot(), 's2')?.name).toBe('zsh');
  });

  it('the end of a long name is its tail, and the ordinal goes after it', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'cart-api-ts65slzs4-7x5nx'));
    h.store.openSession(session('terminal', 'host', 'cart-api-ts65slzs4-7x5nx'));
    const [first, second] = h.store.selectors.sessionIds(h.snapshot(), 'terminal').map((id) => h.store.selectors.sessionItem(h.snapshot(), id));
    expect(first?.head + (first?.tail ?? '')).toBe('cart-api-ts65slzs4-7x5nx');
    expect(first?.tail.length).toBeGreaterThan(0);
    expect(second?.tail.endsWith(' (2)')).toBe(true);
    expect(second?.head).toBe(first?.head);
  });
});

describe('what each part of the panel subscribes to', () => {
  it('the toggle changes when the panel opens or closes and for nothing else', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    const seen: boolean[] = [];
    h.store.subscribeTo(h.store.selectors.open, (value) => seen.push(value));
    h.store.openSession(session('terminal', 'host', 'a'), { reveal: false });
    h.store.resize({ size: 300 });
    h.store.activateTool('logs');
    expect(seen).toEqual([]);
    h.store.show();
    h.store.hide();
    expect(seen).toEqual([true, false]);
  });

  it('the tool strip keeps its ids and its items while a session changes', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    const ids = h.store.selectors.toolIds(h.snapshot());
    const item = h.store.selectors.toolItem(h.snapshot(), 'terminal');
    h.store.setSessionState('s1', { state: 'running' });
    h.store.resize({ size: 300 });
    h.store.hide();
    expect(h.store.selectors.toolIds(h.snapshot())).toBe(ids);
    expect(h.store.selectors.toolItem(h.snapshot(), 'terminal')).toBe(item);
  });

  it('a session tab changes when its own session does, and no other tab does', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('terminal', 'host', 'b'));
    const a = h.store.selectors.sessionItem(h.snapshot(), 's1');
    const b = h.store.selectors.sessionItem(h.snapshot(), 's2');
    const ids = h.store.selectors.sessionIds(h.snapshot(), 'terminal');
    h.store.setSessionState('s1', { state: 'running' });
    expect(h.store.selectors.sessionItem(h.snapshot(), 's1')).not.toBe(a);
    expect(h.store.selectors.sessionItem(h.snapshot(), 's2')).toBe(b);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toBe(ids);
  });

  it('a session body reads its own record: the same object while that session is the same', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    h.store.openSession(session('terminal', 'host', 'b'));
    const a = h.store.selectors.session(h.snapshot(), 's1');
    h.store.setSessionState('s2', { state: 'running' });
    h.store.resize({ size: 300 });
    expect(h.store.selectors.session(h.snapshot(), 's1')).toBe(a);
  });

  it('the list of mounted bodies is the same array until a body mounts or unmounts', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'a'));
    const mounted = h.store.selectors.mounted(h.snapshot());
    h.store.setSessionState('s1', { state: 'running' });
    h.store.resize({ size: 300 });
    h.store.hide();
    expect(h.store.selectors.mounted(h.snapshot())).toBe(mounted);
  });

  it('a hidden session has no item, no record and no place in any list', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [] } });
    h.store.openSession(session('logs', 'acme', 'one'));
    h.store.syncPlugins([]);
    expect(h.store.selectors.sessionItem(h.snapshot(), 's1')).toBeUndefined();
    expect(h.store.selectors.session(h.snapshot(), 's1')).toBeUndefined();
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual([]);
  });
});

// An id is data a plugin or a saved session gives: `constructor` and `__proto__` are as legal as `s1`, and the dictionaries of the model are plain objects, so a lookup that reads the
// prototype chain finds `Object.prototype.constructor` for an id nobody has used (CodeRabbit, state.ts:27).
describe('ids that every object already has a member for', () => {
  const NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

  it('are free ids: a session named so opens, shows, and is found again', () => {
    for (const name of NAMES) {
      const h = boot({ hostTools: HOST_TOOLS });
      expect(h.store.openSession(session('terminal', 'host', 'zsh', { id: name })), name).toEqual({ status: 'done', id: name });
      expect(Object.keys(h.snapshot().sessions), name).toEqual([name]);
      expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal'), name).toEqual([name]);
      expect(h.store.selectors.session(h.snapshot(), name)?.title, name).toBe('zsh');
      expect(h.store.selectors.activeSession(h.snapshot(), 'terminal'), name).toBe(name);
      expect(checkInvariants(h.snapshot()), name).toEqual([]);
      expect(h.store.openSession(session('terminal', 'host', 'again', { id: name })), name).toMatchObject({ status: 'refused', reason: 'taken' });
    }
  });

  it('are no session until one is opened: every operation on a session says so and leaves the state as it was', () => {
    for (const name of NAMES) {
      const h = boot({ hostTools: HOST_TOOLS });
      const before = h.snapshot();
      expect(h.store.setSessionState(name, { state: 'running' }), name).toMatchObject({ status: 'refused', reason: 'missing' });
      expect(h.store.closeSession(name), name).toMatchObject({ status: 'refused', reason: 'missing' });
      expect(h.store.activateSession(name), name).toMatchObject({ status: 'refused', reason: 'missing' });
      expect(h.store.selectors.session(before, name), name).toBeUndefined();
      expect(h.store.selectors.sessionItem(before, name), name).toBeUndefined();
      expect(h.snapshot(), name).toBe(before);
    }
  });

  it('are no tool until one is registered, and a tool named so registers in its place in the order', () => {
    for (const name of NAMES) {
      const h = boot({ hostTools: [tool('terminal', 'Terminal')] });
      const before = h.snapshot();
      expect(h.store.activateTool(name), name).toMatchObject({ status: 'refused', reason: 'missing' });
      expect(h.store.unregisterTool(name), name).toMatchObject({ status: 'refused', reason: 'missing' });
      expect(h.snapshot(), name).toBe(before);
      expect(h.store.registerTool(tool(name, 'Words')), name).toEqual({ status: 'done' });
      expect(h.store.registerTool(tool('logs', 'Logs')), name).toEqual({ status: 'done' });
      // Registration breaks the tie between tools with no order: a tool whose id the prototype also names is the second, and `logs` the third.
      expect(h.store.selectors.toolIds(h.snapshot()), name).toEqual(['terminal', name, 'logs']);
      expect(h.snapshot().registered, name).toBe(3);
      expect(checkInvariants(h.snapshot()), name).toEqual([]);
    }
  });

  it('a session in a tool named so is the tool\'s session on screen, and closing it leaves the tool\'s choice clean', () => {
    const h = boot({ hostTools: [tool('constructor', 'Words'), tool('__proto__', 'Other')] });
    h.store.openSession(session('constructor', 'host', 'a', { id: 'a' }));
    h.store.openSession(session('__proto__', 'host', 'b', { id: 'b' }));
    expect(Object.keys(h.snapshot().active).sort()).toEqual(['__proto__', 'constructor']);
    expect(h.store.selectors.sessionIds(h.snapshot(), 'constructor')).toEqual(['a']);
    expect(h.store.selectors.sessionIds(h.snapshot(), '__proto__')).toEqual(['b']);
    expect(h.store.closeSession('a')).toMatchObject({ status: 'done', active: null });
    expect(Object.keys(h.snapshot().active)).toEqual(['__proto__']);
    expect(checkInvariants(h.snapshot())).toEqual([]);
  });
});

// A tool id and a plugin id are identifiers, not display text: the registry keeps them whole, so a session has to name them whole too (CodeRabbit, sessions.ts:40). Only the words a person reads
// (the title, the scope) are cut.
describe('identifiers longer than the words the model cuts', () => {
  it('a session of a host tool with a 250 character id is in that tool, whole, and shows', () => {
    const id = `tool-${'t'.repeat(245)}`;
    const h = boot({ hostTools: [tool(id, 'Long')] });
    expect(h.store.openSession(session(id, 'host', 'zsh'))).toMatchObject({ status: 'done' });
    expect(h.snapshot().sessions.s1?.tool).toBe(id);
    expect(h.store.selectors.sessionIds(h.snapshot(), id)).toEqual(['s1']);
    expect(h.store.selectors.shown(h.snapshot())).toEqual({ tool: id, session: 's1' });
  });

  it('a session of a live plugin with a 250 character id shows, and ends with the plugin', () => {
    const plugin = `plugin-${'p'.repeat(243)}`;
    const h = boot({ hostTools: HOST_TOOLS, plugins: { [plugin]: [] } });
    expect(h.store.openSession(session('terminal', plugin, 'zsh', { state: 'running' }))).toMatchObject({ status: 'done' });
    expect(h.snapshot().sessions.s1?.plugin).toBe(plugin);
    expect(h.store.selectors.session(h.snapshot(), 's1')?.plugin).toBe(plugin);
    h.store.syncPlugins([]);
    expect(h.store.selectors.session(h.snapshot(), 's1')).toBeUndefined();
    expect(h.snapshot().sessions.s1?.state).toBe('ended');
  });

  it('are still trimmed, as the registry trims them, and still refused when they are empty', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    expect(h.store.openSession(session('  terminal ', 'host', 'zsh'))).toMatchObject({ status: 'done' });
    expect(h.snapshot().sessions.s1?.tool).toBe('terminal');
    expect(h.store.selectors.sessionIds(h.snapshot(), 'terminal')).toEqual(['s1']);
    expect(h.store.openSession(session('   ', 'host', 'zsh'))).toMatchObject({ status: 'refused', reason: 'invalid' });
  });
});

// The mock keeps what it stored within the window: shell-core.js `panelClamp`, registered for `layout.<window>.panel`, is run on load and on every window resize (S103), and writes its answer
// back. A window made smaller and larger again therefore keeps the smaller panel (CodeRabbit, height.test.ts:48: a deviation needs the owner's approval, and there is none).
describe('the height when the window changes (mock: clamp on load and on resize, S103)', () => {
  it('a remembered size that no longer fits is brought within the window, and stays so when the window grows again', () => {
    const h = boot();
    h.store.resize({ size: 500 });
    expect(h.store.fitHeight(620)).toEqual({ status: 'done' });
    expect(h.snapshot().height).toBe(308);
    expect(h.store.fitHeight(1400)).toEqual({ status: 'noop' });
    expect(h.snapshot().height).toBe(308);
  });

  it('a window too short for the minimum gives the minimum', () => {
    const h = boot();
    h.store.resize({ size: 500 });
    h.store.fitHeight(400);
    expect(h.snapshot().height).toBe(120);
  });

  it('changes nothing for a size that fits, for the default (it follows the window by itself), or for a window that says nothing', () => {
    const h = boot();
    const first = h.snapshot();
    expect(h.store.fitHeight(700)).toEqual({ status: 'noop' });
    expect(h.snapshot()).toBe(first);
    h.store.resize({ size: 300 });
    const second = h.snapshot();
    expect(h.store.fitHeight(900)).toEqual({ status: 'noop' });
    expect(h.store.fitHeight(Number.NaN)).toEqual({ status: 'noop' });
    expect(h.store.fitHeight(0)).toEqual({ status: 'noop' });
    expect(h.snapshot()).toBe(second);
    expect(h.notified()).toBe(1);
  });

  it('does not open a hidden panel, and keeps what else it holds', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh'));
    h.store.resize({ size: 500 });
    h.store.hide();
    h.store.fitHeight(620);
    expect(h.snapshot()).toMatchObject({ open: false, height: 308, tool: 'terminal' });
    expect(Object.keys(h.snapshot().sessions)).toEqual(['s1']);
  });
});

describe('a store that is disposed', () => {
  it('tells nobody any more', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.dispose();
    const told = h.notified();
    h.store.show();
    expect(h.notified()).toBe(told);
  });
});

describe('a tool that arrives after the panel was opened', () => {
  it('does not take the panel from the tool on screen, even when it sorts before it', () => {
    const h = boot();
    h.store.syncPlugins([{ id: 'alpha', tools: [tool('streams', 'Alpha streams', 20)] }]);
    h.store.show();
    h.store.syncPlugins([
      { id: 'alpha', tools: [tool('streams', 'Alpha streams', 20)] },
      { id: 'beta', tools: [tool('streams', 'Beta streams', 10)] },
    ]);
    expect(h.store.selectors.toolIds(h.snapshot())).toEqual(['beta:streams', 'alpha:streams']);
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('alpha:streams');
  });

  it('still leaves a panel that was never opened on its first tool', () => {
    const h = boot();
    h.store.syncPlugins([{ id: 'alpha', tools: [tool('streams', 'Alpha streams', 20)] }]);
    h.store.syncPlugins([
      { id: 'alpha', tools: [tool('streams', 'Alpha streams', 20)] },
      { id: 'beta', tools: [tool('streams', 'Beta streams', 10)] },
    ]);
    expect(h.store.selectors.activeTool(h.snapshot())).toBe('beta:streams');
  });
});

describe('a session id that is reused in another tool (CodeRabbit, selectors.ts:48)', () => {
  it('answers with the tool the id belongs to now, though the item the last read kept says the same in everything else', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession({ tool: 'terminal', plugin: 'host', title: 'shared', id: 'x', state: 'running' });
    expect(h.store.selectors.sessionItem(h.snapshot(), 'x')?.tool).toBe('terminal');
    // Closed and opened again under the same id in the other tool, with no read in between: the same title, scope, state and time.
    h.store.closeSession('x');
    h.store.openSession({ tool: 'logs', plugin: 'host', title: 'shared', id: 'x', state: 'running' });
    expect(h.store.selectors.sessionItem(h.snapshot(), 'x')?.tool).toBe('logs');
  });

  it('still keeps the item itself while nothing about it changed', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession({ tool: 'terminal', plugin: 'host', title: 'shared', id: 'x', state: 'running' });
    const before = h.store.selectors.sessionItem(h.snapshot(), 'x');
    h.store.openSession({ tool: 'terminal', plugin: 'host', title: 'other', id: 'y', state: 'running' });
    expect(h.store.selectors.sessionItem(h.snapshot(), 'x')).toBe(before);
  });
});
