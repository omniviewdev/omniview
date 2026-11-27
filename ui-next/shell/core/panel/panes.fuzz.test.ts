import { describe, expect, it } from 'vitest';
import { checkInvariants, createPanelStore, restorePanel, type PanelState, type PanelStore, type PersistedPanel } from './index';
import { PANE_MIN_PX } from './ratios';
import { generator, tool } from './testing';

// The panes under random operations (#697 step 6): splits, focus, sashes, equalising, fitting, closing, and everything else the panel does, with the rules of the panes checked after every operation from
// their words (a plain loop over the state, not `checkInvariants`, which is checked as well), and what is saved coming back whole. Seeded and deterministic: a failure names its seed and step.

const TOOLS = ['terminal', 'logs', 'acme:one', 'nothing'];
const PLUGINS = ['acme', 'beta', 'host'];
const EXTENTS = [100, 160, 240, 400, 800, 1280, 1440, 3000];
const EPSILON = 1e-9;

type Tally = Map<string, number>;
const count = (tally: Tally, name: string): void => {
  tally.set(name, (tally.get(name) ?? 0) + 1);
};

/** The rules of the panes, from their words: every sentence that a state breaks. */
function paneProblems(state: PanelState): string[] {
  const problems: string[] = [];
  const holder = new Map<string, string>();
  for (const [toolId, group] of Object.entries(state.panes)) {
    if (group.panes.length < 2) {
      problems.push(`${toolId} has a group of ${String(group.panes.length)} pane`);
    }

    if (group.ratios.length !== group.panes.length) {
      problems.push(`${toolId} has ${String(group.ratios.length)} ratios for ${String(group.panes.length)} panes`);
    }

    const total = group.ratios.reduce((sum, one) => sum + one, 0);
    if (!(Math.abs(total - 1) <= EPSILON)) {
      problems.push(`the ratios of ${toolId} sum to ${String(total)}`);
    }

    if (group.ratios.some((one) => !(one > 0))) {
      problems.push(`a ratio of ${toolId} is not above zero`);
    }

    if (!group.panes.some((one) => one.id === group.active)) {
      problems.push(`the active pane of ${toolId} does not exist`);
    }

    for (const pane of group.panes) {
      const held = Object.hasOwn(state.sessions, pane.session) ? state.sessions[pane.session] : undefined;
      if (held === undefined || held.tool !== toolId) {
        problems.push(`the pane ${pane.id} of ${toolId} is empty or holds another tool's session`);
      }

      const other = holder.get(pane.session);
      if (other !== undefined) {
        problems.push(`the session ${pane.session} is in two panes (${other} and ${toolId}/${pane.id})`);
      }

      holder.set(pane.session, `${toolId}/${pane.id}`);
    }
  }

  return problems;
}

/** A group the minimum of `extent` holds: every share is at least 80 px of it, wherever the panes can all have 80 px. */
function minimumProblems(state: PanelState, toolId: string, extent: number): string[] {
  const group = Object.hasOwn(state.panes, toolId) ? state.panes[toolId] : undefined;
  if (group === undefined || group.panes.length * PANE_MIN_PX > extent) {
    return [];
  }

  return group.ratios.flatMap((one, index) => (one * extent < PANE_MIN_PX - 1e-6 ? [`pane ${String(index)} of ${toolId} is ${String(one * extent)} px of ${String(extent)}`] : []));
}

function step(store: PanelStore, next: () => number, tally: Tally): { name: string; tool?: string; extent?: number } {
  const state = store.getSnapshot();
  const ids = Object.keys(state.sessions);
  const pick = <T>(list: readonly T[]): T => list[next() % list.length];
  const toolId = pick(TOOLS);
  const extent = pick(EXTENTS);
  const roll = next() % 18;
  switch (roll) {
    case 0:
    case 1:
    case 2:
    case 3: {
      const copy = ids.length > 0 && next() % 6 === 0;
      const before = state;
      const result = store.splitPane(toolId, { plugin: pick(PLUGINS), title: `t${String(next() % 4)}`, state: pick(['starting', 'running'] as const), ...(copy ? { id: pick(ids) } : {}) }, { extent });
      count(tally, `split:${result.status === 'refused' ? result.reason : result.status}`);
      if (copy) {
        expect(result, 'a split with the id of a session is never a copy of it').toMatchObject({ status: 'refused', reason: 'taken' });
        expect(store.getSnapshot()).toBe(before);
      }

      if (result.status === 'done') {
        expect(Object.keys(store.getSnapshot().sessions).length, 'a split adds exactly one session').toBe(ids.length + 1);
        expect(ids).not.toContain(result.id);
      }

      return { name: 'split', tool: toolId, extent };
    }

    case 4:
    case 5: {
      const group = Object.hasOwn(state.panes, toolId) ? state.panes[toolId] : undefined;
      const known = group === undefined ? undefined : pick(group.panes);
      const result = store.focusPane(toolId, known !== undefined && next() % 5 !== 0 ? known.id : 'p99');
      count(tally, `focus:${result.status}`);
      return { name: 'focus' };
    }

    case 6:
    case 7: {
      const result = store.moveSash(toolId, (next() % 5) - 1, next() % 4 === 0 ? pick([-1, 2, Number.NaN]) : (next() % 1001) / 1000, extent);
      count(tally, `sash:${result.status}`);
      return { name: 'sash', tool: toolId, extent: result.status === 'refused' ? undefined : extent };
    }

    case 8: {
      const result = store.equalisePanes(toolId, extent);
      count(tally, `equalise:${result.status}`);
      return { name: 'equalise', tool: toolId, extent: result.status === 'refused' ? undefined : extent };
    }

    case 9: {
      const result = store.fitPanes(toolId, extent);
      count(tally, `fit:${result.status}`);
      return { name: 'fit', tool: toolId, extent: result.status === 'refused' ? undefined : extent };
    }

    case 10:
    case 11:
      if (ids.length > 0) {
        const id = pick(ids);
        const inPane = Object.values(state.panes).some((group) => group.panes.some((pane) => pane.session === id));
        count(tally, inPane ? 'close:in a pane' : 'close:in no pane');
        const groups = Object.keys(state.panes).length;
        store.closeSession(id);
        if (Object.keys(store.getSnapshot().panes).length < groups) {
          count(tally, 'close:dissolved a group');
        }
      }

      return { name: 'close' };
    case 12:
    case 13:
      store.openSession({ tool: toolId, plugin: pick(PLUGINS), title: `t${String(next() % 4)}` }, { reveal: next() % 3 !== 0 });
      return { name: 'open' };
    case 14:
      if (ids.length > 0) {
        const id = pick(ids);
        const swapped = Object.values(state.panes).some((group) => group.panes.length > 1 && !group.panes.some((pane) => pane.session === id));
        store.activateSession(id);
        if (swapped) {
          count(tally, 'activate:maybe swapped');
        }
      }

      return { name: 'activate' };
    case 15:
      store.syncPlugins(PLUGINS.filter((id) => id !== 'host' && next() % 3 !== 0).map((id) => ({ id, tools: [tool('one')] })));
      return { name: 'syncPlugins' };
    case 16:
      if (ids.length > 0) {
        store.reorderSession(pick(ids), (next() % 6) - 1);
      }

      return { name: 'reorder' };
    default:
      if (next() % 2 === 0) {
        store.show({ tool: toolId });
      } else {
        store.hide();
      }

      return { name: 'show/hide' };
  }
}

describe('the panes under random operations', () => {
  it('keep every rule of the panes after every operation, and what is saved comes back whole', () => {
    const tally: Tally = new Map();
    for (let seed = 1; seed <= 200; seed += 1) {
      let ids = 0;
      let clock = 1;
      const store = createPanelStore({ newId: () => `s${String((ids += 1))}`, now: () => (clock += 7) });
      store.registerTool(tool('terminal', 'Terminal', 10));
      store.registerTool(tool('logs', 'Logs', 20));
      store.syncPlugins([{ id: 'acme', tools: [tool('one')] }, { id: 'beta', tools: [] }]);
      const next = generator(seed);
      for (let operation = 0; operation < 150; operation += 1) {
        const done = step(store, next, tally);
        const state = store.getSnapshot();
        const where = `seed ${String(seed)}, operation ${String(operation)} (${done.name})`;
        expect(paneProblems(state), where).toEqual([]);
        expect(checkInvariants(state), where).toEqual([]);
        if (done.tool !== undefined && done.extent !== undefined) {
          expect(minimumProblems(state, done.tool, done.extent), `${where}: the minimum`).toEqual([]);
          if (Object.hasOwn(state.panes, done.tool)) {
            count(tally, 'min:checked');
          }
        }

        // What a tool draws: shares that sum to 1 for panes that are all visible sessions of it, the active one among them.
        for (const id of store.selectors.toolIds(state)) {
          const layout = store.selectors.paneLayout(state, id);
          if (layout === null) {
            expect(store.selectors.activeSession(state, id), `${where}: ${id} draws nothing only when it has no session`).toBeNull();
            continue;
          }

          expect(Math.abs(layout.ratios.reduce((sum, one) => sum + one, 0) - 1), `${where}: the drawn shares of ${id}`).toBeLessThanOrEqual(EPSILON);
          expect(layout.ratios.length).toBe(layout.panes.length);
          expect(layout.panes.some((pane) => pane.id === layout.active)).toBe(true);
          for (const pane of layout.panes) {
            expect(store.selectors.session(state, pane.session), `${where}: the drawn pane ${pane.id} of ${id} is a visible session`).toBeDefined();
          }

          if (layout.panes.length > 1) {
            count(tally, `layout:${String(Math.min(layout.panes.length, 4))} panes`);
          }
        }

        // Every pane the panel draws has its body mounted while the panel is open.
        if (state.open) {
          const on = store.selectors.activeTool(state);
          const layout = on === null ? null : store.selectors.paneLayout(state, on);
          for (const pane of layout?.panes ?? []) {
            expect(state.mounted, `${where}: the body of ${pane.session} is mounted`).toContain(pane.session);
          }
        }
      }

      const state = store.getSnapshot();
      const document = store.serialise();
      expect(JSON.parse(JSON.stringify(document))).toEqual(document);
      const restored = restorePanel(JSON.parse(JSON.stringify(document)), { now: clock });
      expect(restored.ok, `seed ${String(seed)}: what it saved is readable`).toBe(true);
      if (!restored.ok) {
        continue;
      }

      expect(checkInvariants(restored.state), `seed ${String(seed)}: the restored panel`).toEqual([]);
      expect(paneProblems(restored.state), `seed ${String(seed)}: the restored panes`).toEqual([]);
      expect(restored.repaired, `seed ${String(seed)}: nothing needed repair`).toBe(false);
      const saved = new Set(document.sessions.map((one) => one.id));
      for (const [toolId, group] of Object.entries(state.panes)) {
        const kept = group.panes.filter((pane) => saved.has(pane.session));
        const back = Object.hasOwn(restored.state.panes, toolId) ? restored.state.panes[toolId] : undefined;
        if (kept.length < 2) {
          expect(back, `seed ${String(seed)}: ${toolId} has fewer than two saved panes`).toBeUndefined();
          continue;
        }

        expect(back?.panes.map((pane) => pane.session), `seed ${String(seed)}: ${toolId} panes`).toEqual(kept.map((pane) => pane.session));
        if (kept.length === group.panes.length) {
          expect(back?.ratios, `seed ${String(seed)}: ${toolId} ratios come back as they were`).toEqual(group.ratios);
          expect(back?.panes.find((pane) => pane.id === back.active)?.session, `seed ${String(seed)}: ${toolId} active pane`).toBe(group.panes.find((pane) => pane.id === group.active)?.session);
          count(tally, 'restore:group whole');
        }
      }

      expect(Object.keys(restored.state.panes).sort()).toEqual(Object.keys(restored.state.panes).filter((id) => Object.hasOwn(state.panes, id)).sort());
      expect(serialiseAgain(restored.state), `seed ${String(seed)}: what comes back saves the same`).toEqual(document);

      // A window saved before panes: the same document without its layout reads, loads one pane per tool, and saves exactly what it was.
      const { layout: _layout, ...old } = document;
      const loaded = restorePanel(JSON.parse(JSON.stringify(old)), { now: clock });
      expect(loaded.ok, `seed ${String(seed)}: an old document is read`).toBe(true);
      if (loaded.ok) {
        expect(loaded.repaired, `seed ${String(seed)}: an old document needs no repair`).toBe(false);
        expect(loaded.state.panes).toEqual({});
        expect(checkInvariants(loaded.state)).toEqual([]);
        const again = createPanelStore({ initial: loaded.state }).serialise();
        expect(again, `seed ${String(seed)}: an old document round-trips`).toEqual(old);
        count(tally, document.layout === undefined ? 'old:no panes in it' : 'old:panes stripped');
      }
    }

    for (const event of ['split:done', 'split:full', 'split:taken', 'split:missing', 'focus:done', 'focus:noop', 'focus:refused', 'sash:done', 'sash:noop', 'sash:refused', 'equalise:done', 'equalise:noop', 'fit:done', 'fit:noop', 'close:in a pane', 'close:in no pane', 'close:dissolved a group', 'activate:maybe swapped', 'layout:2 panes', 'layout:3 panes', 'layout:4 panes', 'min:checked', 'restore:group whole', 'old:panes stripped']) {
      expect(tally.get(event) ?? 0, `event ${event}`).toBeGreaterThan(30);
    }
  });
});

function serialiseAgain(state: PanelState): PersistedPanel {
  return createPanelStore({ initial: state }).serialise();
}
