import { describe, expect, it } from 'vitest';
import { checkInvariants } from './state';
import { boot, session, tool } from './testing';
import type { PanelState, Session, SessionId } from './types';

// The oracle of the fuzz, proved to see what it is for. `checkInvariants` is what every operation of the fuzz is checked with, so a rule it does not enforce is a rule nothing enforces: each rule about a
// held session (A21) is broken here by hand in a sound state, and the sentence that names it must come out. The state is the real model's, with sessions of the host's Logs tool held by their plugin's unload.

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
