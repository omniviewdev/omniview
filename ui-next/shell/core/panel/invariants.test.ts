import { describe, expect, it } from 'vitest';
import { checkInvariants } from './state';
import { boot, session, tabProblems, tool, type Harness } from './testing';
import type { PanelState, Selectors, Session, SessionId, SessionItem } from './types';

// The oracle of the fuzz, proved to see what it is for. `checkInvariants` is what every operation of the fuzz is checked with, so a rule it does not enforce is a rule nothing enforces: each rule about a
// held session (A21) is broken here by hand in a sound state, and the sentence that names it must come out. The state is the real model's, with sessions of the host's Logs tool held by their plugin's unload.
// The same for the rules of the tabs (`tabProblems`, written from the words of the rule and not from the selector): each is broken in the tabs the selector makes, and the sentence that names it comes out.

const HOST_TOOLS = [tool('logs', 'Logs', 20)];

/** A sound state: `s1` was running and is held (acme left), `s2` had failed on its own and is held too, `s3` is beta's and live. */
function sound(): PanelState {
  const h = boot({ hostTools: HOST_TOOLS, plugins: { acme: [tool('metrics', 'Metrics', 30)], beta: [] } });
  h.store.openSession(session('logs', 'acme', 'follows', { state: 'running' }));
  h.store.openSession(session('logs', 'acme', 'broke', { state: 'failed', cause: 'The source did not answer.' }));
  h.store.openSession(session('logs', 'beta', 'stays', { state: 'running' }));
  h.store.syncPlugins([{ id: 'beta', tools: [] }]);
  return h.snapshot();
}

/** The state with one session made into what `change` says, and nothing else touched. */
function damaged(state: PanelState, id: SessionId, change: (found: Session) => Session): PanelState {
  const found = state.sessions[id];
  if (found === undefined) {
    throw new Error(`no session ${id}`);
  }

  return { ...state, sessions: { ...state.sessions, [id]: change(found) } };
}

describe('the invariants about a held session', () => {
  it('are met by the state the model makes: held sessions that ended with the unload and that were over before it, in a tool of the host', () => {
    const state = sound();
    expect(state.sessions.s1).toMatchObject({ held: true, state: 'ended' });
    expect(state.sessions.s2).toMatchObject({ held: true, state: 'failed', cause: 'The source did not answer.' });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('see a held session that is not over: it was kept across an unload, and what is kept is ended or failed', () => {
    for (const running of ['starting', 'running'] as const) {
      const state = damaged(sound(), 's1', (found) => ({ ...found, state: running, cause: '' }));
      expect(checkInvariants(state), running).toContain('the session s1 is held and is not over');
    }
  });

  it('see a held session in a tool a plugin brought: only a tool of the host keeps its sessions across its plugin\'s unload', () => {
    const state = damaged(sound(), 's1', (found) => ({ ...found, tool: 'acme:metrics' }));
    expect(checkInvariants(state)).toContain('the session s1 is held in acme:metrics, which is not a tool of the host');
  });

  it('see a body that is mounted while its plugin is off and the session is not held: the rule written out, not read from the function that implements it', () => {
    const state = damaged(sound(), 's1', (found) => {
      const { held: _held, ...rest } = found;
      return rest;
    });
    expect(state.mounted).toContain('s1');
    expect(checkInvariants(state)).toContain('s1 is mounted, its plugin is off and it is not held');
  });

  it('say nothing of a held session that says no cause (it had ended on its own, and was not ended by the unload), or of a body mounted while its plugin is off when the session is held', () => {
    const state = damaged(sound(), 's2', (found) => ({ ...found, state: 'ended', cause: '' }));
    expect(checkInvariants(state)).toEqual([]);
    expect(state.mounted).toContain('s1');
    expect(checkInvariants(state).filter((line) => line.includes('mounted'))).toEqual([]);
  });
});

/** A strip of the host's Logs tool: `orders-api/app` in two scopes (and a second one of the first scope), and `orders-api/migrate`, which has no twin. */
function strip(): Harness {
  const h = boot({ hostTools: HOST_TOOLS });
  h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard', state: 'running' }));
  h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'south-yard', state: 'running' }));
  h.store.openSession(session('logs', 'host', 'orders-api/migrate', { scope: 'north-yard', state: 'running' }));
  h.store.openSession(session('logs', 'host', 'orders-api/app', { scope: 'north-yard', state: 'running' }));
  return h;
}

/** The selectors of the harness's store, with the item of one session made into what `change` says: a tab that says what the model's selector does not. */
function seenWith(h: Harness, id: SessionId, change: (item: SessionItem) => SessionItem): Pick<Selectors, 'toolIds' | 'sessionIds' | 'sessionItem'> {
  const { selectors } = h.store;
  return {
    toolIds: selectors.toolIds,
    sessionIds: selectors.sessionIds,
    sessionItem: (state, one) => {
      const item = selectors.sessionItem(state, one);
      return item !== undefined && one === id ? change(item) : item;
    },
  };
}

describe('the rules of the tabs', () => {
  it('are met by the tabs the selector makes: a scope for the twins of another scope, an ordinal for the twin of one, a name of its own for every tab', () => {
    const h = strip();
    expect(h.store.selectors.sessionIds(h.snapshot(), 'logs').map((id) => h.store.selectors.sessionItem(h.snapshot(), id)?.name)).toEqual([
      'orders-api/app · north-yard',
      'orders-api/app · south-yard',
      'orders-api/migrate',
      'orders-api/app (2) · north-yard',
    ]);
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
  });

  it('see a scope drawn by a tab that has no twin of another scope', () => {
    const h = strip();
    const problems = tabProblems(h.snapshot(), seenWith(h, 's3', (item) => ({ ...item, scope: 'north-yard', name: 'orders-api/migrate · north-yard' })));
    expect(problems).toContain('the tab of s3 draws the scope "north-yard", wanted "" (it has no twin of another scope)');
  });

  it('see a scope left out of a tab that has a twin of another scope', () => {
    const h = strip();
    const problems = tabProblems(h.snapshot(), seenWith(h, 's2', (item) => ({ ...item, scope: '', name: 'orders-api/app' })));
    expect(problems).toContain('the tab of s2 draws the scope "", wanted "south-yard" (it has a twin of another scope)');
  });

  it('see a name that is not the title, the ordinal and the scope the tab draws, in that order', () => {
    const h = strip();
    const problems = tabProblems(h.snapshot(), seenWith(h, 's4', (item) => ({ ...item, name: 'orders-api/app · north-yard (2)' })));
    expect(problems).toContain('the tab of s4 is named "orders-api/app · north-yard (2)", wanted "orders-api/app (2) · north-yard"');
  });

  it('see a twin of one scope that has no ordinal', () => {
    const h = strip();
    const problems = tabProblems(h.snapshot(), seenWith(h, 's4', (item) => ({ ...item, tail: '/app', name: 'orders-api/app · north-yard' })));
    expect(problems.join('\n')).toContain('the tab of s4 is named "orders-api/app · north-yard", wanted "orders-api/app (2) · north-yard"');
    expect(problems.join('\n')).toContain('the tabs of s1 and s4 are both named "orders-api/app · north-yard"');
  });

  it('see a head and a tail that do not draw the title and the ordinal', () => {
    const h = strip();
    const problems = tabProblems(h.snapshot(), seenWith(h, 's3', (item) => ({ ...item, tail: '/migrate-x' })));
    expect(problems).toContain('the tab of s3 draws "orders-api/migrate-x" for its name, wanted "orders-api/migrate"');
  });

  it('see a strip that lists a session that is not listed', () => {
    const h = strip();
    const damaged = { ...h.store.selectors, sessionIds: (state: PanelState, toolId: string) => h.store.selectors.sessionIds(state, toolId).slice(1) };
    expect(tabProblems(h.snapshot(), damaged).join('\n')).toContain('the strip of logs lists s2, s3, s4, not the listed sessions s1, s2, s3, s4');
  });

  it('are met by a title that looks like another\'s ordinal, whose later session is told another number', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'a'));
    h.store.openSession(session('logs', 'host', 'a'));
    h.store.openSession(session('logs', 'host', 'a (2)'));
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    expect(h.store.selectors.sessionItem(h.snapshot(), 's3')?.name).toBe('a (2) (2)');
  });

  it('are met by a title that reads like another session\'s name and state: an ended `task` and a running `task, ended`, whose later session is told another number', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { scope: 'north', state: 'ended' }));
    h.store.openSession(session('logs', 'host', 'task, ended', { scope: 'south', state: 'running' }));
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    expect(h.store.selectors.sessionItem(h.snapshot(), 's2')?.name).toBe('task, ended (2)');
  });

  it('see two tabs that are heard alike once their states are said, though their names differ', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { state: 'ended' }));
    h.store.openSession(session('logs', 'host', 'task, ended', { state: 'running' }));
    const problems = tabProblems(h.snapshot(), seenWith(h, 's2', (item) => ({ ...item, name: 'task, ended' })));
    expect(problems.join('\n')).toContain('the tabs of s1 and s2 are both heard as "task, ended"');
  });

  it('are met by a title that looks like another\'s ordinal beside an ended session, and see two tabs drawn alike though what is heard differs (CodeRabbit, #609)', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { state: 'running' }));
    h.store.openSession(session('logs', 'host', 'task', { state: 'running' }));
    h.store.openSession(session('logs', 'host', 'task (2)', { state: 'ended' }));
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    const problems = tabProblems(h.snapshot(), seenWith(h, 's3', (item) => ({ ...item, name: 'task (2)' })));
    expect(problems.join('\n')).toContain('the tabs of s2 and s3 are both named "task (2)"');
  });

  it('are met by two titles that differ only by white space, and see two tabs whose names differ only by it, which a person hears as one', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'build  job', { scope: 'dev' }));
    h.store.openSession(session('logs', 'host', 'build job', { scope: 'dev' }));
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    const problems = tabProblems(h.snapshot(), seenWith(h, 's2', (item) => ({ ...item, name: 'build job' })));
    expect(problems.join('\n')).toContain('are both heard as');
  });

  it('are met after a retitle that makes a title read like another session\'s name and state, and see the tab that kept the name it had before the retitle', () => {
    const h = boot({ hostTools: HOST_TOOLS });
    h.store.openSession(session('logs', 'host', 'task', { scope: 'north', state: 'ended' }));
    h.store.openSession(session('logs', 'host', 'other', { scope: 'south', state: 'running' }));
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    h.store.retitleSession('s2', 'task, ended');
    expect(checkInvariants(h.snapshot())).toEqual([]);
    expect(tabProblems(h.snapshot(), h.store.selectors)).toEqual([]);
    expect(h.store.selectors.sessionItem(h.snapshot(), 's2')?.name).toBe('task, ended (2)');
    // A strip that drew the retitled tab with the title alone would have two tabs heard as `task, ended`.
    const problems = tabProblems(h.snapshot(), seenWith(h, 's2', (item) => ({ ...item, name: 'task, ended', tail: '' })));
    expect(problems.join('\n')).toContain('the tabs of s1 and s2 are both heard as "task, ended"');
  });
});
