import { describe, expect, it } from 'vitest';
import { checkInvariants } from './state';
import { boot, session, tool } from './testing';
import type { PaneGroup, PanelState } from './types';

// The oracle of the fuzz sees the rules of the panes. Each is broken by hand in a sound state the model made and the sentence that names it must come out; `checkInvariants` is what every operation of the
// fuzz is checked with, so a rule it does not state is one nothing enforces.

function sound(): PanelState {
  const h = boot({ hostTools: [tool('terminal', 'Terminal', 10), tool('logs', 'Logs', 20)] });
  h.store.openSession(session('terminal', 'host', 'shell 1'));
  h.store.splitPane('terminal', { plugin: 'host', title: 'shell 2' }, { extent: 1000 });
  h.store.splitPane('terminal', { plugin: 'host', title: 'shell 3' }, { extent: 1000 });
  h.store.openSession(session('logs', 'host', 'log 1'));
  return h.snapshot();
}

const withGroup = (state: PanelState, change: (group: PaneGroup) => Partial<PaneGroup>): PanelState => {
  const group = state.panes.terminal;
  if (group === undefined) {
    throw new Error('no group');
  }

  return { ...state, panes: { ...state.panes, terminal: { ...group, ...change(group) } } };
};

describe('the invariants about panes', () => {
  it('are met by the state the model makes', () => {
    expect(checkInvariants(sound())).toEqual([]);
  });

  it('see a group of fewer than two panes: a group that falls to one is dissolved', () => {
    const state = withGroup(sound(), (group) => ({ panes: group.panes.slice(0, 1), ratios: [1], active: 'p1' }));
    expect(checkInvariants(state)).toContain('the panes of terminal are fewer than two');
  });

  it('see a pane that holds no session, or one of another tool: no pane is empty', () => {
    const missing = withGroup(sound(), (group) => ({ panes: [group.panes[0], { id: 'p2', session: 'gone' }, group.panes[2]] }));
    expect(checkInvariants(missing)).toContain('the pane p2 of terminal holds gone, which is not a session of terminal');
    const other = withGroup(sound(), (group) => ({ panes: [group.panes[0], { id: 'p2', session: 's4' }, group.panes[2]] }));
    expect(checkInvariants(other)).toContain('the pane p2 of terminal holds s4, which is not a session of terminal');
  });

  it('see a session in two panes', () => {
    const state = withGroup(sound(), (group) => ({ panes: [group.panes[0], { id: 'p2', session: 's1' }, group.panes[2]] }));
    expect(checkInvariants(state)).toContain('the session s1 is in two panes');
  });

  it('see a session in the panes of two tools', () => {
    const state = sound();
    const logs: PaneGroup = { axis: 'row', panes: [{ id: 'p1', session: 's4' }, { id: 'p2', session: 's1' }], ratios: [0.5, 0.5], active: 'p1', seq: 3 };
    expect(checkInvariants({ ...state, panes: { ...state.panes, logs } })).toContain('the session s1 is in two panes');
  });

  it('see two panes with one slot id', () => {
    const state = withGroup(sound(), (group) => ({ panes: [group.panes[0], { id: 'p1', session: 's2' }, group.panes[2]] }));
    expect(checkInvariants(state)).toContain('terminal has two panes called p1');
  });

  it('see ratios that are not one per pane', () => {
    expect(checkInvariants(withGroup(sound(), () => ({ ratios: [0.5, 0.5] })))).toContain('terminal has 2 ratios for 3 panes');
  });

  it('see a ratio that is not above zero or not a number', () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = withGroup(sound(), () => ({ ratios: [bad, 0.5, 0.5] }));
      expect(checkInvariants(state), String(bad)).toContain('a ratio of terminal is not above zero');
    }
  });

  it('see ratios that do not sum to 1', () => {
    for (const ratios of [[0.4, 0.3, 0.3 + 1e-6], [0.5, 0.5, 0.5], [0.2, 0.2, 0.2]]) {
      const found = checkInvariants(withGroup(sound(), () => ({ ratios })));
      expect(found.some((one) => one.startsWith('the ratios of terminal sum to ')), JSON.stringify(ratios)).toBe(true);
    }
  });

  it('accept ratios that sum to 1 within floating point', () => {
    expect(checkInvariants(withGroup(sound(), () => ({ ratios: [0.1 + 0.2, 0.7 - 0.2, 0.2 + 1e-12] })))).toEqual([]);
  });

  it('see an active pane that is not one of the panes', () => {
    expect(checkInvariants(withGroup(sound(), () => ({ active: 'p9' })))).toContain('the active pane of terminal is not one of its panes');
  });

  it('see an active session that is not the session of the active pane', () => {
    const state = withGroup(sound(), () => ({ active: 'p1' }));
    expect(checkInvariants(state)).toContain('the active session of terminal is not the session of its active pane');
  });

  it('see an axis that is neither row nor column', () => {
    const state = withGroup(sound(), () => ({ axis: 'diagonal' as never }));
    expect(checkInvariants(state)).toContain('the group of terminal has an axis that is neither row nor column');
  });

  it('see panes that hold sessions the tool does not have, whatever the tool', () => {
    const state = sound();
    const ghost: PaneGroup = { axis: 'row', panes: [{ id: 'p1', session: 'x' }, { id: 'p2', session: 'y' }], ratios: [0.5, 0.5], active: 'p1', seq: 3 };
    const found = checkInvariants({ ...state, panes: { ...state.panes, ghost } });
    expect(found).toContain('the pane p1 of ghost holds x, which is not a session of ghost');
  });
});
