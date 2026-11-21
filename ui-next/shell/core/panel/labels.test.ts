import { describe, expect, it } from 'vitest';
import { restorePanel } from './persist';
import { boot, session, tool, type Harness } from './testing';
import type { SessionItem } from './types';

// What a session tab says of itself (SCT1, TI1; the mock's `labelParts`, shell-panel.js:207-221): its title, an ordinal for the second and later session of one title and one scope, and its scope ONLY
// when it is needed to tell two open sessions of one title apart. A tab that has no twin carries no scope: the scope is a fact of the session (its card says it), not of every tab. The accessible name is
// what the tab draws and nothing less: a name that holds the scope for a tab that draws none, or leaves out one it draws, is a tab a speech user cannot call by what they see (WCAG 2.5.3).

const HOST_TOOLS = [tool('terminal', 'Terminal', 10), tool('logs', 'Logs', 20)];

/** The tabs of a tool, in strip order. */
const tabsOf = (h: Harness, toolId: string): SessionItem[] =>
  h.store.selectors.sessionIds(h.snapshot(), toolId).map((id) => {
    const item = h.store.selectors.sessionItem(h.snapshot(), id);
    if (item === undefined) {
      throw new Error(`the strip lists ${id} and it has no item`);
    }

    return item;
  });

const namesOf = (h: Harness, toolId: string): string[] => tabsOf(h, toolId).map((item) => item.name);
const scopesOf = (h: Harness, toolId: string): string[] => tabsOf(h, toolId).map((item) => item.scope);

describe('the scope of a session tab: only to tell twins apart (the mock\'s rule)', () => {
  it('is not drawn for a session that has no twin: its tab is its title, whatever scope the session has', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    const [only] = tabsOf(h, 'logs');
    expect(only).toMatchObject({ title: 'orders-api/app', scope: '', name: 'orders-api/app' });
    // The session itself still has its scope: the card and the saved session read it there.
    expect(h.snapshot().sessions.s1?.scope).toBe('north-yard');
  });

  it('is drawn on both tabs when two sessions share a title and not a scope, and each name carries its own', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    expect(scopesOf(h, 'logs')).toEqual(['north-yard', 'south-yard']);
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard']);
  });

  it('is taken away from the other tab when its twin closes, and comes back when a twin of another scope opens again', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    h.store.closeSession('s2');
    expect(tabsOf(h, 'logs')).toMatchObject([{ id: 's1', scope: '', name: 'orders-api/app' }]);
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard']);
    // The one that is left after the FIRST closes is the one that loses it, as well.
    h.store.closeSession('s1');
    expect(tabsOf(h, 'logs')).toMatchObject([{ id: 's3', scope: '', name: 'orders-api/app' }]);
  });

  it('is not drawn for sessions of different titles, however many scopes there are: a title tells them apart already', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/migrate', { scope: 'south-yard' }));
    h.store.openSession(session('logs', 'host', 'ledger-sync/app', { scope: 'east-dock' }));
    expect(scopesOf(h, 'logs')).toEqual(['', '', '']);
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app', 'orders-api/migrate', 'ledger-sync/app']);
  });

  it('is drawn only on the titles that are shared: a third session with a title of its own has none', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/migrate', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/migrate', 'orders-api/app · south-yard']);
  });

  it('is not drawn for twins of ONE scope: an ordinal tells them apart, the first having none', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    for (let i = 0; i < 3; i += 1) {
      h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    }

    expect(scopesOf(h, 'logs')).toEqual(['', '', '']);
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app', 'orders-api/app (2)', 'orders-api/app (3)']);
  });

  it('puts the ordinal before the scope, in the order the tab draws them, when twins differ in both', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard', 'orders-api/app (2) · north-yard']);
    expect(tabsOf(h, 'logs').map((item) => item.tail.endsWith(' (2)'))).toEqual([false, false, true]);
  });

  it('draws the scope of a session that has one and says nothing for its twin that has none: the two are told apart by it', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app'));
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app']);
  });

  it('keeps the tools apart: a title that another tool also has is nobody\'s twin', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('terminal', 'host', 'zsh', { scope: 'dev' }));
    h.store.openSession(session('logs', 'host', 'zsh', { scope: 'prod' }));
    expect(namesOf(h, 'terminal')).toEqual(['zsh']);
    expect(namesOf(h, 'logs')).toEqual(['zsh']);
  });

  it('counts the sessions that are listed and no others: a restored session waits, hidden, for its plugin, and is nobody\'s twin until the plugin has loaded', () => {
    const saved = restorePanel({ version: 1, open: false, height: null, tool: null, active: {}, sessions: [{ id: 'r1', tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north-yard' }] }, { now: 5_000 });
    if (!saved.ok) {
      throw new Error('the saved panel is readable');
    }

    const h = boot({ initial: saved.state, hostTools: HOST_TOOLS, plugins: { beta: [] } });
    h.store.openSession(session('logs', 'beta', 'orders-api/app', { scope: 'south-yard', state: 'running' }));
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs')).toEqual(['s1']);
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app']);
    h.store.syncPlugins([{ id: 'acme', tools: [] }, { id: 'beta', tools: [] }]);
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard']);
  });

  it('says the scope of a held session while it is listed beside a twin of another scope', () => {
    const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [], beta: [] } });
    h.store.openSession(session('logs', 'acme', 'orders-api/app', { scope: 'north-yard', state: 'running' }));
    h.store.openSession(session('logs', 'beta', 'orders-api/app', { scope: 'south-yard', state: 'running' }));
    h.store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(h.snapshot().sessions.s1).toMatchObject({ held: true, state: 'ended' });
    expect(namesOf(h, 'logs')).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard']);
  });
});

describe('the names of the tabs of a tool: the accessible name always tells two of them apart (WCAG 2.4.6, TI1)', () => {
  it('are all different, even when a title looks like an ordinal: the later session is the one that is told another number', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app'));
    h.store.openSession(session('logs', 'host', 'orders-api/app'));
    h.store.openSession(session('logs', 'host', 'orders-api/app (2)'));
    const names = namesOf(h, 'logs');
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['orders-api/app', 'orders-api/app (2)', 'orders-api/app (2) (2)']);
  });

  it('are all different when a title looks like another session\'s title and scope', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app · north-yard'));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    const names = namesOf(h, 'logs');
    expect(new Set(names).size).toBe(names.length);
  });

  it('are the text the tab draws: the head and the tail are the title and the ordinal, and the scope a tab shows comes after them in the name', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'cart-api-7d8c6f49b-f8q4m', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'cart-api-7d8c6f49b-f8q4m', { scope: 'south-yard' }));
    h.store.openSession(session('logs', 'host', 'cart-api-7d8c6f49b-f8q4m', { scope: 'south-yard' }));
    for (const item of tabsOf(h, 'logs')) {
      const ordinal = / \(\d+\)$/.exec(item.tail)?.[0] ?? '';
      expect(item.head + item.tail, `${item.id}: what the name part of the tab draws is the title and the ordinal`).toBe(item.title + ordinal);
      expect(item.name, `${item.id}: the name is the title, the ordinal, then the scope the tab draws`).toBe(`${item.title}${ordinal}${item.scope === '' ? '' : ` · ${item.scope}`}`);
    }
  });
});

describe('what a tab\'s item holds while the strip changes (MNR-T16: a tab renders when its own face changed)', () => {
  it('stays the same object while nothing the tab says changed, and is a new one when a twin of another scope arrives or leaves', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard' }));
    h.store.openSession(session('logs', 'host', 'orders-api/migrate', { scope: 'north-yard' }));
    const alone = h.store.selectors.sessionItem(h.snapshot(), 's1');
    // A session of another title changes nothing of this tab.
    h.store.openSession(session('logs', 'host', 'ledger-sync/app', { scope: 'south-yard' }));
    expect(h.store.selectors.sessionItem(h.snapshot(), 's1')).toBe(alone);
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard' }));
    const twinned = h.store.selectors.sessionItem(h.snapshot(), 's1');
    expect(twinned).not.toBe(alone);
    expect(twinned).toMatchObject({ scope: 'north-yard', name: 'orders-api/app · north-yard' });
    h.store.closeSession('s4');
    expect(h.store.selectors.sessionItem(h.snapshot(), 's1')).toMatchObject({ scope: '', name: 'orders-api/app' });
    // The tab of another title was never touched by any of it.
    const other = h.store.selectors.sessionItem(h.snapshot(), 's2');
    h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'east-dock' }));
    expect(h.store.selectors.sessionItem(h.snapshot(), 's2')).toBe(other);
  });
});

/** What a person who cannot see the strip hears of a tab: its name and, when its session is not running, its state (the panel's accessible name, words.ts). The words are written out here, as the rule says them. */
const heardOf = (h: Harness, toolId: string): string[] => tabsOf(h, toolId).map((item) => (item.state === 'running' ? item.name : `${item.name}, ${item.state}`));

describe('what a person who cannot see the strip hears of a tab: its name and its state, and never another tab\'s (CodeRabbit, selectors.ts, #609)', () => {
  it('tells apart an ended `task` and a running `task, ended` in either order: the later tab is the one that is numbered, and each keeps its state', () => {
    const early = boot({ hostTools: HOST_TOOLS });
    early.store.openSession(session('logs', 'host', 'task', { scope: 'north', state: 'ended' }));
    early.store.openSession(session('logs', 'host', 'task, ended', { scope: 'south', state: 'running' }));
    expect(heardOf(early, 'logs')).toEqual(['task, ended', 'task, ended (2)']);
    const late = boot({ hostTools: HOST_TOOLS });
    late.store.openSession(session('logs', 'host', 'task, ended', { scope: 'south', state: 'running' }));
    late.store.openSession(session('logs', 'host', 'task', { scope: 'north', state: 'ended' }));
    expect(heardOf(late, 'logs')).toEqual(['task, ended', 'task (2), ended']);
  });

  it('does it for each word a state says: a running `task, failed` beside a failed `task`, and a running `task, starting` beside a starting `task`', () => {
    for (const state of ['failed', 'starting'] as const) {
      const h = boot({ hostTools: HOST_TOOLS });
      h.store.openSession(session('logs', 'host', 'task', { state }));
      h.store.openSession(session('logs', 'host', `task, ${state}`, { state: 'running' }));
      const heard = heardOf(h, 'logs');
      expect(new Set(heard).size, `${state}: ${JSON.stringify(heard)}`).toBe(2);
      expect(heard[0]).toBe(`task, ${state}`);
    }
  });

  it('follows a state that changes: two titles that sound alike only once one has ended are numbered then, and are not any more when it closes', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { state: 'running' }));
    h.store.openSession(session('logs', 'host', 'task, ended', { state: 'running' }));
    expect(heardOf(h, 'logs')).toEqual(['task', 'task, ended']);
    h.store.setSessionState('s1', { state: 'ended' });
    expect(heardOf(h, 'logs')).toEqual(['task, ended', 'task, ended (2)']);
    h.store.closeSession('s1');
    expect(heardOf(h, 'logs')).toEqual(['task, ended']);
  });
});

// CodeRabbit (selectors.ts, #609, second pass): the drawn name of a tab is its own as well as what is heard, and white space that the accessible name collapses does not tell two tabs apart.
describe('a name of its own for every tab, drawn and heard (CodeRabbit, #609, second pass)', () => {
  it('numbers again a title that looks like the ordinal of another when only its state would keep the names apart: two running `task`, then an ended `task (2)`', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { state: 'running' }));
    h.store.openSession(session('logs', 'host', 'task', { state: 'running' }));
    h.store.openSession(session('logs', 'host', 'task (2)', { state: 'ended' }));
    expect(namesOf(h, 'logs')).toEqual(['task', 'task (2)', 'task (2) (2)']);
    expect(heardOf(h, 'logs')).toEqual(['task', 'task (2)', 'task (2) (2), ended']);
  });

  it('tells apart two titles that differ only by white space, which a person who cannot see the strip hears as one name and a sighted one sees as one: `build  job` and `build job`', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'build  job', { scope: 'dev', state: 'running' }));
    h.store.openSession(session('logs', 'host', 'build job', { scope: 'dev', state: 'running' }));
    const heard = heardOf(h, 'logs').map((name) => name.replace(/\s+/g, ' ').trim());
    expect(heard).toEqual(['build job', 'build job (2)']);
  });
});
