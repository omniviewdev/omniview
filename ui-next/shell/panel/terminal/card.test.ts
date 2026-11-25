import { describe, expect, it } from 'vitest';
import { cardOf } from '../card';
import { terminalCardOf } from './card';
import { sessionStateOf } from './state';
import { TERMINAL_ICON } from './tool';
import type { TerminalFeedSnapshot } from './feed';
import type { TerminalSessionRecord } from './TerminalSessions';

// What the hover card of a terminal session says (ch16 SCD1; the mock's `cardFor`, `kindWords` and `sessionWords`): the kind (Shell), the facts between the resource and the state, and the state in the words of a
// terminal. The host owns it. The facts a producer does not tell are not on it, and the card has one way to say them when it does.

const record = (snapshot: TerminalFeedSnapshot, patch: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord => ({ id: 'local', plugin: 'host', resource: undefined, snapshot, ...patch });

describe('the card of a terminal session', () => {
  it('is a Shell, with the tool\'s glyph, and says the state of a terminal: Connected', () => {
    expect(terminalCardOf(record({ state: 'running' }))).toEqual({ kind: 'Shell', icon: TERMINAL_ICON, resource: undefined, facts: [], state: { label: 'Connected' } });
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
      icon: TERMINAL_ICON,
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

// A terminal that outlives the page (T2-go): the card says what the page is doing with it in the words of the lane, and still names its shell. The reason under the state is the session's own cause (the shell completes the
// card with it, `../card.ts`), which `sessionStateOf` gives: these read the card as a person sees it, the two put together.
describe('the card of a terminal that outlives the page', () => {
  const seen = (snapshot: TerminalFeedSnapshot) => {
    const session = { id: 's1', tool: 'terminal', plugin: 'host', title: 'zsh', scope: '', since: 1, ...sessionStateOf(snapshot) };
    return cardOf(session, { label: 'Terminal', icon: TERMINAL_ICON }, terminalCardOf(record(snapshot)), 2);
  };

  it('says Reattaching while the page takes the terminal back, and names its shell: the host told the program before it answered', () => {
    expect(terminalCardOf(record({ state: 'starting', program: 'zsh' }))).toMatchObject({ facts: [['Shell', 'zsh']], state: { label: 'Reattaching' } });
    expect(terminalCardOf(record({ state: 'starting' })).state).toEqual({ label: 'Connecting' });
  });

  it('says that another tab took the terminal, with the sentence that says why input is off as its reason, and still names the shell', () => {
    const snapshot: TerminalFeedSnapshot = { state: 'ended', program: 'zsh', detached: { by: 'taken-over' } };
    expect(terminalCardOf(record(snapshot))).toMatchObject({ facts: [['Shell', 'zsh']], state: { label: 'Taken over by another tab' } });
    expect(seen(snapshot).state).toMatchObject({ label: 'Taken over by another tab', reason: 'Input is off. The shell keeps running in the tab that took it.' });
  });

  it('says that no tab took it back in time, with no reason: the process is over, and there is nothing more to say of it', () => {
    expect(seen({ state: 'ended', exit: { closedBy: 'detach-timeout' } }).state).toMatchObject({ label: 'Closed: no tab took it back in time', reason: '' });
  });

  it('follows the later fact: a terminal this page lost and that then ended says how it ended, with no reason', () => {
    expect(seen({ state: 'ended', detached: { by: 'taken-over' }, exit: { closedBy: 'detach-timeout' } }).state).toMatchObject({ label: 'Closed: no tab took it back in time', reason: '' });
    expect(seen({ state: 'ended', detached: { by: 'taken-over' }, exit: { code: 0 } }).state).toMatchObject({ label: 'Exited with code 0', reason: '' });
  });

  it('says that the tab that took the terminal has closed, with the sentence that the shell keeps running until its lease ends as its reason, and still names the shell (T2d: the page may take it back)', () => {
    const snapshot: TerminalFeedSnapshot = { state: 'ended', program: 'zsh', detached: { by: 'taken-over', free: true } };
    expect(terminalCardOf(record(snapshot))).toMatchObject({ facts: [['Shell', 'zsh']], state: { label: 'The tab that took this terminal has closed.' } });
    expect(seen(snapshot).state).toMatchObject({ label: 'The tab that took this terminal has closed.', reason: 'The shell keeps running until its lease ends.' });
  });

  it('keeps the card of a terminal that another tab still holds as it was, whether `free` is absent or false', () => {
    for (const detached of [{ by: 'taken-over' }, { by: 'taken-over', free: false }] as const) {
      expect(seen({ state: 'ended', detached }).state).toMatchObject({ label: 'Taken over by another tab', reason: 'Input is off. The shell keeps running in the tab that took it.' });
    }
  });

  it('says how the process ended once the host says so, whatever the page lost before, with no reason', () => {
    expect(seen({ state: 'ended', detached: { by: 'taken-over', free: true }, exit: { closedBy: 'detach-timeout' } }).state).toMatchObject({ label: 'Closed: no tab took it back in time', reason: '' });
  });

  it('keeps the host\'s sentence as the reason of a start that no shell answered, whether or not the host listed the shells it tried', () => {
    const message = 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found';
    const sentence = `No shell could be started. ${message}.`;
    const tried = [{ source: 'requested', path: '/bin/zsh', reason: 'not-found' }];
    expect(seen({ state: 'failed', cause: { stage: 'start', code: 'SHELL_UNAVAILABLE', message, tried } }).state).toMatchObject({ label: 'Failed to start', reason: sentence });
    expect(seen({ state: 'failed', cause: { stage: 'start', code: 'SHELL_UNAVAILABLE', message } }).state).toMatchObject({ label: 'Failed to start', reason: sentence });
  });
});
