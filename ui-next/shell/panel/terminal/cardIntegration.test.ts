import { describe, expect, it } from 'vitest';
import { terminalCardOf } from './card';
import type { TerminalFeedSnapshot } from './feed';
import type { TerminalSessionRecord } from './TerminalSessions';

// THE TIER ON THE SESSION CARD (issue #694 step 6): `Shell integration` is a fact of the card, in words, when the producer says anything of the integration, and is not on the card when it says nothing (card.ts: a fact not told is not
// guessed). The words are `integration.ts`'s: a card and the screen reader's description say the same.

const record = (snapshot: TerminalFeedSnapshot): TerminalSessionRecord => ({ id: 'local', plugin: 'host', resource: undefined, snapshot });

describe('the card of a terminal says its shell integration', () => {
  it('says Rich, with what it gives, for a shell that proved itself, after the shell it runs', () => {
    expect(terminalCardOf(record({ state: 'running', program: 'zsh', integration: { state: 'on' }, proven: true })).facts).toEqual([
      ['Shell', 'zsh'],
      ['Shell integration', 'Rich: the shell tells this terminal each command, its exit status, its directory and its time.'],
    ]);
  });

  it('says Basic while the host started the shell with the integration and the shell has not proved itself', () => {
    expect(terminalCardOf(record({ state: 'running', integration: { state: 'on' } })).facts).toEqual([['Shell integration', 'Basic: the shell was started with the integration and has not yet proved a command or a directory.']]);
  });

  it('says None, and why, for a shell the host did not integrate', () => {
    expect(terminalCardOf(record({ state: 'running', integration: { state: 'off' } })).facts).toEqual([['Shell integration', 'None: shell integration is turned off in Settings.']]);
    expect(terminalCardOf(record({ state: 'running', integration: { state: 'skipped', reason: 'posix' } })).facts?.[0]?.[0]).toBe('Shell integration');
  });

  it('says nothing when the producer says nothing of the integration, and a terminal that ended keeps what it had', () => {
    expect(terminalCardOf(record({ state: 'running' })).facts).toEqual([]);
    expect(terminalCardOf(record({ state: 'ended', integration: { state: 'on' }, proven: true })).facts).toEqual([['Shell integration', 'Rich: the shell tells this terminal each command, its exit status, its directory and its time.']]);
    expect(terminalCardOf(undefined).facts).toEqual([]);
  });
});
