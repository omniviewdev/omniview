import { describe, expect, it } from 'vitest';
import { terminalCardOf } from './card';
import type { TerminalFeedSnapshot } from './feed';
import type { TerminalSessionRecord } from './TerminalSessions';

// What the hover card of a terminal session says (ch16 SCD1; the mock's `cardFor`, `kindWords` and `sessionWords`): the kind (Shell), the facts between the resource and the state, and the state in the words of a
// terminal. The host owns it. The facts a producer does not tell are not on it, and the card has one way to say them when it does.

const record = (snapshot: TerminalFeedSnapshot, patch: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord => ({ id: 'local', plugin: 'host', resource: undefined, snapshot, ...patch });

describe('the card of a terminal session', () => {
  it('is a Shell, with the tool\'s glyph, and says the state of a terminal: Connected', () => {
    expect(terminalCardOf(record({ state: 'running' }))).toEqual({ kind: 'Shell', icon: 'square-terminal', resource: undefined, facts: [], state: { label: 'Connected' } });
  });

  it('says Connecting while it starts, and Failed (to start) with the reason left to the session\'s cause', () => {
    expect(terminalCardOf(record({ state: 'starting' })).state).toEqual({ label: 'Connecting' });
    expect(terminalCardOf(record({ state: 'failed', cause: { stage: 'start', message: 'x' } })).state).toEqual({ label: 'Failed to start' });
  });

  it('names the program when the producer says what it runs, and not before', () => {
    expect(terminalCardOf(record({ state: 'running', program: 'zsh' })).facts).toEqual([['Shell', 'zsh']]);
    expect(terminalCardOf(record({ state: 'running' })).facts).toEqual([]);
  });

  it('says how the process ended when the producer says so, and just that it ended when it does not: one card for both', () => {
    expect(terminalCardOf(record({ state: 'ended', exit: { code: 3 } })).state).toEqual({ label: 'Exited with code 3' });
    expect(terminalCardOf(record({ state: 'ended' })).state).toEqual({ label: 'Ended' });
  });

  it('is the card of an ended terminal for a session that has no record at all (one restored from the last run: its process is gone)', () => {
    expect(terminalCardOf(undefined)).toEqual({
      kind: 'Shell',
      icon: 'square-terminal',
      resource: undefined,
      facts: [],
      state: { label: 'Ended' },
    });
  });

  it('gives the resource of a plugin\'s target as a link: its words, its kind, its glyph and its page as the tab model knows it', () => {
    const card = terminalCardOf(
      record({ state: 'running' }, { plugin: 'acme', resource: { label: 'Item web-0', kind: 'Item', icon: 'box', route: { plugin: 'acme', contribution: 'item', params: { name: 'web-0' } } } }),
    );
    expect(card.resource).toMatchObject({ label: 'Item web-0', kind: 'Item', icon: 'box', route: { plugin: 'acme', contribution: 'item', params: { name: 'web-0' } } });
  });
});
