import { describe, expect, it } from 'vitest';
import type { TerminalFeedCause, TerminalFeedSnapshot, TerminalShellAttempt } from './feed';
import { causeSentence, closeQuestionOf, drainLine, exitLine, failureLines, laneOf, sessionStateOf, stateWords } from './state';

// What a feed says about itself, as the panel's session says it, and the words the tab, the card, the status lane and the transcript use for it (ch16 S116's state table; the mock's `sessionWords`,
// `stripHtml` and `exitSession`). The facts a producer may not know are optional in the snapshot (an exit code, a signal, what runs in the session): each is read in ONE place, so that a session that
// ended with no word of its code and one that ended with its code are the same code path with one member more.

const snap = (state: TerminalFeedSnapshot['state'], extra: Partial<TerminalFeedSnapshot> = {}): TerminalFeedSnapshot => ({ state, ...extra });

describe('the state of the session a feed is', () => {
  it.each([
    ['starting', 'starting'],
    ['running', 'running'],
    ['ended', 'ended'],
  ] as const)('maps a feed that is %s to a session that is %s, with no cause', (feed, session) => {
    expect(sessionStateOf(snap(feed))).toEqual({ state: session, cause: '' });
  });

  it('keeps an ended session with no cause whatever it knows of how the process ended: that is the lane\'s and the card\'s to say, and an exit is not a failure', () => {
    expect(sessionStateOf(snap('ended', { exit: { code: 3 } }))).toEqual({ state: 'ended', cause: '' });
    expect(sessionStateOf(snap('ended', { exit: { signal: 'SIGKILL' } }))).toEqual({ state: 'ended', cause: '' });
  });

  it('maps a failure to a failed session with the cause as a sentence, by where it happened', () => {
    expect(sessionStateOf(snap('failed', { cause: { stage: 'start', message: 'Failed to start terminal' } }))).toEqual({ state: 'failed', cause: 'Couldn\'t start the terminal. Failed to start terminal.' });
    expect(sessionStateOf(snap('failed', { cause: { stage: 'session', message: 'The connection was closed' } }))).toEqual({ state: 'failed', cause: 'The terminal stopped. The connection was closed.' });
    expect(sessionStateOf(snap('failed', { cause: { stage: 'input', message: 'Session not found' } }))).toEqual({ state: 'failed', cause: 'Couldn\'t send what you typed to the terminal. Session not found.' });
  });

  it('gives a failure with no cause a sentence too, so the card is never left with a blank reason', () => {
    expect(sessionStateOf(snap('failed'))).toEqual({ state: 'failed', cause: 'The terminal stopped. The producer gave no reason.' });
  });
});

describe('the cause of a failure as a sentence', () => {
  it('ends the producer\'s own words with a full stop when they have none, and leaves other endings and the words themselves alone', () => {
    const at = (message: string, stage: TerminalFeedCause['stage'] = 'session') => causeSentence({ stage, message });
    expect(at('The shell was not found')).toBe('The terminal stopped. The shell was not found.');
    expect(at('Is the service running?')).toBe('The terminal stopped. Is the service running?');
    expect(at('   ')).toBe('The terminal stopped. The producer gave no reason.');
  });

  it('says a start that no shell could answer by its code, and gives the host\'s own words after it, the paths it tried among them: nothing reads the words, the code is what the host branches on', () => {
    const detail = 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none/sh": not found; /bin/bash: not found';
    expect(causeSentence({ stage: 'start', code: 'SHELL_UNAVAILABLE', message: detail })).toBe(`No shell could be started. ${detail}.`);
    expect(causeSentence({ stage: 'start', code: 'SHELL_UNSUPPORTED', message: 'unsupported terminal shell "/bin/cat"' })).toBe('This program is not a shell Omniview starts. unsupported terminal shell "/bin/cat".');
    expect(causeSentence({ stage: 'start', code: 'START_FAILED', message: 'Failed to start terminal' })).toBe('Couldn\'t start the terminal. Failed to start terminal.');
    expect(causeSentence({ stage: 'start', message: 'Failed to start terminal' })).toBe('Couldn\'t start the terminal. Failed to start terminal.');
  });

  it('keeps the typed code to the stage that has it: a refusal to start is the one the words are about', () => {
    expect(causeSentence({ stage: 'input', code: 'SHELL_UNAVAILABLE', message: 'x' })).toBe('Couldn\'t send what you typed to the terminal. x.');
  });
});

describe('the words of a session', () => {
  it('are the mock\'s for a terminal: Connecting, Connected, Ended, Failed (to start)', () => {
    expect(stateWords(snap('starting'))).toBe('Connecting');
    expect(stateWords(snap('running'))).toBe('Connected');
    expect(stateWords(snap('ended'))).toBe('Ended');
    expect(stateWords(snap('failed', { cause: { stage: 'session', message: 'x' } }))).toBe('Failed');
    expect(stateWords(snap('failed', { cause: { stage: 'input', message: 'x' } }))).toBe('Failed');
    expect(stateWords(snap('failed', { cause: { stage: 'start', message: 'x' } }))).toBe('Failed to start');
    expect(stateWords(snap('failed'))).toBe('Failed');
  });

  it('say how the process ended when its producer told, and only then (S116: Exited with code N)', () => {
    expect(stateWords(snap('ended', { exit: { code: 0 } }))).toBe('Exited with code 0');
    expect(stateWords(snap('ended', { exit: { code: 130 } }))).toBe('Exited with code 130');
    expect(stateWords(snap('ended', { exit: { signal: 'SIGKILL' } }))).toBe('Ended by SIGKILL');
    expect(stateWords(snap('ended', { exit: {} }))).toBe('Ended');
  });

  it('say how the host ended it, and how a signal did, when the host said so (typed end)', () => {
    expect(stateWords(snap('ended', { exit: { signal: 'SIGSEGV', signalNumber: 11, coreDumped: true } }))).toBe('Ended by SIGSEGV (core dumped)');
    expect(stateWords(snap('ended', { exit: { signal: 'SIGTERM', signalNumber: 15 } }))).toBe('Ended by SIGTERM');
    expect(stateWords(snap('ended', { exit: { closedBy: 'request' } }))).toBe('Closed');
    expect(stateWords(snap('ended', { exit: { closedBy: 'window' } }))).toBe('Closed with its window');
    expect(stateWords(snap('ended', { exit: { closedBy: 'shutdown' } }))).toBe('Closed when Omniview quit');
  });

  it('say the code before anything else: a process that exited is what it exited with, whatever else was told', () => {
    expect(stateWords(snap('ended', { exit: { code: 4, droppedBytes: 10, drainCapped: true } }))).toBe('Exited with code 4');
  });

  it('say nothing of an exit before the process ended: a fact of a running session is not its end', () => {
    expect(stateWords(snap('running', { exit: { code: 1 } }))).toBe('Connected');
  });

  it('read the snapshot, not a session\'s state, so a session that has no feed at all (a restored one) has the words of an ended one', () => {
    expect(stateWords(undefined)).toBe('Ended');
  });
});

describe('the status lane under the screen (the mock\'s .ptool__status, a fixed 28 px lane)', () => {
  it('is empty while the session runs: a connected terminal has no health cue of its own', () => {
    expect(laneOf(snap('running'))).toEqual({ words: '', note: '' });
  });

  it('says it is connecting while the session starts', () => {
    expect(laneOf(snap('starting'))).toEqual({ words: 'Connecting', note: '' });
  });

  it('says in words that the terminal ended, that input is off and that the output stays readable', () => {
    expect(laneOf(snap('ended'))).toEqual({ words: 'Ended', note: 'Input is off. Its output stays readable here.' });
    expect(laneOf(snap('ended', { exit: { code: 2 } }))).toEqual({ words: 'Exited with code 2', note: 'Input is off. Its output stays readable here.' });
  });

  it('says what failed, with the producer\'s words', () => {
    expect(laneOf(snap('failed', { cause: { stage: 'start', message: 'Shell not found' } }))).toEqual({ words: 'Failed to start', note: 'Couldn\'t start the terminal. Shell not found.' });
    expect(laneOf(snap('failed', { cause: { stage: 'input', message: 'Session not found' } }))).toEqual({ words: 'Failed', note: 'Couldn\'t send what you typed to the terminal. Session not found.' });
  });

  it('is the same lane for a session that has no feed: it ended, and its output is gone (it was restored from the last run)', () => {
    expect(laneOf(undefined)).toEqual({ words: 'Ended', note: 'The earlier output is gone.' });
  });
});

describe('the last line of an ended transcript (S116: [Process exited with code N], muted)', () => {
  it('says the code when the producer told it, the signal when it told that, and just that the process ended when it told neither', () => {
    expect(exitLine(snap('ended', { exit: { code: 0 } }))).toBe('[Process exited with code 0]');
    expect(exitLine(snap('ended', { exit: { code: 127 } }))).toBe('[Process exited with code 127]');
    expect(exitLine(snap('ended', { exit: { signal: 'SIGHUP' } }))).toBe('[Process ended by SIGHUP]');
    expect(exitLine(snap('ended', { exit: { signal: 'SIGSEGV', coreDumped: true } }))).toBe('[Process ended by SIGSEGV (core dumped)]');
    expect(exitLine(snap('ended', { exit: { closedBy: 'shutdown' } }))).toBe('[Process closed when Omniview quit]');
    expect(exitLine(snap('ended', { exit: { closedBy: 'request' } }))).toBe('[Process closed]');
    expect(exitLine(snap('ended'))).toBe('[Process ended]');
  });

  it('is nothing for a session that did not end: a failure says itself in the lane, and nothing is written into the transcript of a process that runs', () => {
    expect(exitLine(snap('running'))).toBe('');
    expect(exitLine(snap('failed', { cause: { stage: 'session', message: 'x' } }))).toBe('');
    expect(exitLine(snap('starting'))).toBe('');
  });

  it('says in a line of its own, when the host said so, that a program kept the terminal open after the shell exited and the host stopped reading it, and how much it dropped', () => {
    expect(drainLine(snap('ended', { exit: { code: 0, drainCapped: true, droppedBytes: 4_096 } }))).toBe('[A program kept the terminal open after the shell exited, so the host stopped reading it and dropped 4 KB of its output]');
    expect(drainLine(snap('ended', { exit: { code: 0, drainCapped: true } }))).toBe('[A program kept the terminal open after the shell exited, so the host stopped reading it]');
    expect(drainLine(snap('ended', { exit: { code: 0 } }))).toBe('');
    expect(drainLine(snap('ended'))).toBe('');
    expect(drainLine(snap('running', { exit: { drainCapped: true } }))).toBe('');
  });
});

describe('what a start that failed writes into the transcript', () => {
  it('is the typed words and then the producer\'s own, in two muted lines, for a start no shell could answer', () => {
    const message = 'shell executable unavailable: tried /bin/zsh: not found; /bin/bash: not found';
    expect(failureLines(snap('failed', { cause: { stage: 'start', code: 'SHELL_UNAVAILABLE', message } }))).toEqual(['[No shell could be started]', `[${message}]`]);
    expect(failureLines(snap('failed', { cause: { stage: 'start', code: 'SHELL_UNSUPPORTED', message: 'unsupported' } }))).toEqual(['[This program is not a shell Omniview starts]', '[unsupported]']);
    expect(failureLines(snap('failed', { cause: { stage: 'start', message: 'Failed to start terminal' } }))).toEqual(['[The terminal could not start]', '[Failed to start terminal]']);
  });

  it('has one line when the producer said nothing, and nothing for a failure that did not happen at the start: the lane says those', () => {
    expect(failureLines(snap('failed', { cause: { stage: 'start', message: '  ' } }))).toEqual(['[The terminal could not start]']);
    expect(failureLines(snap('failed', { cause: { stage: 'session', message: 'x' } }))).toEqual([]);
    expect(failureLines(snap('failed', { cause: { stage: 'input', message: 'x' } }))).toEqual([]);
    expect(failureLines(snap('failed'))).toEqual([]);
    expect(failureLines(snap('running'))).toEqual([]);
    expect(failureLines(snap('ended'))).toEqual([]);
  });
});

describe('the question a close asks (S115, L12: a close with a process running asks first; a close with nothing running is immediate)', () => {
  it('asks for a running session when the producer cannot say what runs in it (no answer, or `unknown`): the shell itself is a running process, and "may be running" is the truthful answer until the producer knows', () => {
    const general = {
      title: 'Terminate session?',
      body: 'This ends the terminal session. Programs it left running in the background may keep running.',
      confirm: 'Terminate session',
    };
    expect(closeQuestionOf(snap('running'))).toEqual(general);
    expect(closeQuestionOf(snap('running'), undefined)).toEqual(general);
    expect(closeQuestionOf(snap('running'), { state: 'unknown' })).toEqual(general);
  });

  it('names the program when the producer says what runs', () => {
    expect(closeQuestionOf(snap('running'), { state: 'busy', name: 'sleep' })).toEqual({
      title: 'Terminate session?',
      body: 'sleep is running in this terminal. This ends the terminal session and stops it.',
      confirm: 'Terminate session',
    });
    expect(closeQuestionOf(snap('running'), { state: 'busy' })?.body).toBe('A program is running in this terminal. This ends the terminal session and stops it.');
    expect(closeQuestionOf(snap('running'), { state: 'busy', name: '   ' })?.body).toBe('A program is running in this terminal. This ends the terminal session and stops it.');
  });

  it('does not ask when the producer says that nothing runs but the shell at its prompt: that is the "any other close" of S115', () => {
    expect(closeQuestionOf(snap('running'), { state: 'idle' })).toBeUndefined();
  });

  it.each(['starting', 'ended', 'failed'] as const)('does not ask for a session that is %s, whatever the producer says: there is nothing running to end', (state) => {
    expect(closeQuestionOf(snap(state))).toBeUndefined();
    expect(closeQuestionOf(snap(state), { state: 'busy', name: 'sleep' })).toBeUndefined();
    expect(closeQuestionOf(snap(state), { state: 'unknown' })).toBeUndefined();
  });

  it('does not ask for a session that has no feed: nothing runs in it', () => {
    expect(closeQuestionOf(undefined)).toBeUndefined();
  });
});

// A terminal that outlives the page: the page may lose a terminal that still runs (another stream took it), the host may close one that no page took back before its lease ran out, and a page that comes back is
// taking a terminal over. Each is said in words, in the lane, in the transcript, on the card and as the tab's cause; one place decides them, and a snapshot may carry both what the page lost and how the process ended:
// the words follow the later fact.
const TAKEN = 'Taken over by another tab';
const TAKEN_NOTE = 'Input is off. The shell keeps running in the tab that took it.';
const LEASE_RAN_OUT = 'Closed: no tab took it back in time';
const lost = (by: 'taken-over', extra: Partial<TerminalFeedSnapshot> = {}): TerminalFeedSnapshot => snap('ended', { detached: { by }, ...extra });

describe('a terminal this page lost, and one the host closed when no tab took it back', () => {
  it('says who has it, and not that it ended: the shell is still running', () => {
    expect(stateWords(lost('taken-over'))).toBe(TAKEN);
  });

  it('says that the lease ran out when the host closed a terminal that no tab took back in time', () => {
    expect(stateWords(snap('ended', { exit: { closedBy: 'detach-timeout' } }))).toBe(LEASE_RAN_OUT);
  });

  it('follows the later fact when the snapshot has both: the end the host says is what the terminal came to after this page lost it, and a loss that says nothing of how it ended is the words of the loss', () => {
    expect(stateWords(lost('taken-over', { exit: { closedBy: 'detach-timeout' } }))).toBe(LEASE_RAN_OUT);
    expect(stateWords(lost('taken-over', { exit: { code: 0 } }))).toBe('Exited with code 0');
    expect(stateWords(lost('taken-over', { exit: { signal: 'SIGHUP' } }))).toBe('Ended by SIGHUP');
    expect(stateWords(lost('taken-over', { exit: {} }))).toBe(TAKEN);
  });

  it('says nothing of a loss before the session ended: a fact of a session that is not over is not its end', () => {
    expect(stateWords(snap('running', { detached: { by: 'taken-over' } }))).toBe('Connected');
    expect(stateWords(snap('failed', { detached: { by: 'taken-over' }, cause: { stage: 'session', message: 'x' } }))).toBe('Failed');
  });

  it('says Reattaching while the page takes a terminal back, which is a start that already knows its program, and Connecting for a first start, which does not', () => {
    expect(stateWords(snap('starting', { program: 'zsh' }))).toBe('Reattaching');
    expect(stateWords(snap('starting'))).toBe('Connecting');
    expect(stateWords(snap('starting', { program: '  ' }))).toBe('Connecting');
    expect(stateWords(snap('running', { program: 'zsh' }))).toBe('Connected');
  });

  describe('in the lane under the screen', () => {
    it('says who took the terminal, and that the shell keeps running there', () => {
      expect(laneOf(lost('taken-over'))).toEqual({ words: TAKEN, note: TAKEN_NOTE });
    });

    it('says that the lease ran out with the words of any other end: the process is over, and its output stays readable', () => {
      expect(laneOf(snap('ended', { exit: { closedBy: 'detach-timeout' } }))).toEqual({ words: LEASE_RAN_OUT, note: 'Input is off. Its output stays readable here.' });
    });

    it('follows the later fact: a terminal this page lost and that then ended is over, so the shell no longer keeps running anywhere', () => {
      const ended = { words: LEASE_RAN_OUT, note: 'Input is off. Its output stays readable here.' };
      expect(laneOf(lost('taken-over', { exit: { closedBy: 'detach-timeout' } }))).toEqual(ended);
      expect(laneOf(lost('taken-over', { exit: { code: 2 } }))).toEqual({ words: 'Exited with code 2', note: 'Input is off. Its output stays readable here.' });
      expect(laneOf(lost('taken-over', { exit: {} }))).toEqual({ words: TAKEN, note: TAKEN_NOTE });
    });

    it('says Reattaching while the terminal is taken back, and nothing more', () => {
      expect(laneOf(snap('starting', { program: 'zsh' }))).toEqual({ words: 'Reattaching', note: '' });
      expect(laneOf(snap('starting'))).toEqual({ words: 'Connecting', note: '' });
    });
  });

  describe('as the last line of the transcript', () => {
    it('is the words of the lane in brackets, with no process that ended: the process did not', () => {
      expect(exitLine(lost('taken-over'))).toBe(`[${TAKEN}]`);
    });

    it('says that the process was closed when no tab took it back in time', () => {
      expect(exitLine(snap('ended', { exit: { closedBy: 'detach-timeout' } }))).toBe('[Process closed: no tab took it back in time]');
    });

    it('follows the later fact', () => {
      expect(exitLine(lost('taken-over', { exit: { code: 1 } }))).toBe('[Process exited with code 1]');
      expect(exitLine(lost('taken-over', { exit: {} }))).toBe(`[${TAKEN}]`);
    });

    it('is nothing before the session ended', () => {
      expect(exitLine(snap('running', { detached: { by: 'taken-over' } }))).toBe('');
    });
  });

  describe('as the tab\'s cause, which the card prints as its reason', () => {
    it('is the sentence of the lane while the shell runs on: an end that is no failure, and one a person is told the reason of', () => {
      expect(sessionStateOf(lost('taken-over'))).toEqual({ state: 'ended', cause: TAKEN_NOTE });
    });

    it('is nothing once the process is over, whatever this page lost before: there is no shell left to keep running', () => {
      expect(sessionStateOf(snap('ended', { exit: { closedBy: 'detach-timeout' } }))).toEqual({ state: 'ended', cause: '' });
      expect(sessionStateOf(lost('taken-over', { exit: { code: 0 } }))).toEqual({ state: 'ended', cause: '' });
    });

    it('is nothing for a session that is taken back: it has not ended', () => {
      expect(sessionStateOf(snap('starting', { program: 'zsh' }))).toEqual({ state: 'starting', cause: '' });
    });
  });

  describe('a session that ends this way closes with no question, as every session that has ended does', () => {
    it.each([
      ['taken over', lost('taken-over')],
      ['closed when no tab took it back in time', snap('ended', { exit: { closedBy: 'detach-timeout' } })],
    ])('when it was %s', (_name, snapshot) => {
      expect(closeQuestionOf(snapshot)).toBeUndefined();
      expect(closeQuestionOf(snapshot, { state: 'busy', name: 'vim' })).toBeUndefined();
    });
  });
});

// A terminal whose taker has gone (T2d, `detached.free`): the tab that took the terminal from this page has let it go (the host's listing says no stream holds it: `refresh`), so nobody holds it and its lease
// runs, and this page may take it back (a button in the lane: `TerminalBody`). The words say so in place of "taken over", in the lane, the transcript, the card and the tab's cause; how the process ended, when the host
// says so, is still the later fact.
const FREE = 'The tab that took this terminal has closed.';
const FREE_NOTE = 'The shell keeps running until its lease ends.';
const freed = (extra: Partial<TerminalFeedSnapshot> = {}): TerminalFeedSnapshot => snap('ended', { detached: { by: 'taken-over', free: true }, ...extra });

describe('a terminal whose taker has gone (T2d: the tab that took it has closed, so this page may take it back)', () => {
  it('says in the lane that the tab that took the terminal has closed', () => {
    expect(laneOf(freed()).words).toBe(FREE);
  });

  it('says in the lane, after it, that the shell keeps running until its lease ends', () => {
    expect(laneOf(freed()).note).toBe(FREE_NOTE);
  });

  it('reads, in the lane, as the one sentence: the words and the note with a space between them', () => {
    const lane = laneOf(freed());
    expect(`${lane.words} ${lane.note}`).toBe('The tab that took this terminal has closed. The shell keeps running until its lease ends.');
  });

  it('says the same in the last line of the transcript, muted, with no process that ended: the process did not', () => {
    expect(exitLine(freed())).toBe(`[${FREE}]`);
  });

  it('says the same on the card as its state, and the sentence after it as its reason: the shell keeps running until its lease ends', () => {
    expect(stateWords(freed())).toBe(FREE);
    expect(sessionStateOf(freed())).toEqual({ state: 'ended', cause: FREE_NOTE });
  });

  it('leaves the words of a terminal that another tab still holds as they were: taken over, with no tab that has gone', () => {
    for (const detached of [{ by: 'taken-over' }, { by: 'taken-over', free: false }, { by: 'taken-over', free: undefined }] as const) {
      const snapshot = snap('ended', { detached });
      expect(laneOf(snapshot)).toEqual({ words: TAKEN, note: TAKEN_NOTE });
      expect(exitLine(snapshot)).toBe(`[${TAKEN}]`);
      expect(stateWords(snapshot)).toBe(TAKEN);
      expect(sessionStateOf(snapshot)).toEqual({ state: 'ended', cause: TAKEN_NOTE });
    }
  });

  it('follows the later fact when the host then says how it ended: the lease ran out, the shell exited, a signal ended it', () => {
    expect(laneOf(freed({ exit: { closedBy: 'detach-timeout' } }))).toEqual({ words: LEASE_RAN_OUT, note: 'Input is off. Its output stays readable here.' });
    expect(exitLine(freed({ exit: { closedBy: 'detach-timeout' } }))).toBe('[Process closed: no tab took it back in time]');
    expect(stateWords(freed({ exit: { code: 0 } }))).toBe('Exited with code 0');
    expect(laneOf(freed({ exit: { signal: 'SIGHUP' } })).words).toBe('Ended by SIGHUP');
    expect(sessionStateOf(freed({ exit: { code: 0 } }))).toEqual({ state: 'ended', cause: '' });
    // An end that says nothing of how the process ended is not a later fact.
    expect(laneOf(freed({ exit: {} })).words).toBe(FREE);
  });

  it('says nothing of a taker that has gone before the session ended: a fact of a session that is not over is not its end', () => {
    expect(stateWords(snap('running', { detached: { by: 'taken-over', free: true } }))).toBe('Connected');
    expect(laneOf(snap('running', { detached: { by: 'taken-over', free: true } }))).toEqual({ words: '', note: '' });
    expect(exitLine(snap('running', { detached: { by: 'taken-over', free: true } }))).toBe('');
  });

  it('closes with no question, as every session that has ended does', () => {
    expect(closeQuestionOf(freed())).toBeUndefined();
    expect(closeQuestionOf(freed(), { state: 'busy', name: 'vim' })).toBeUndefined();
  });
});

describe('the shells the host tried, when no shell could be started (host #672: `AppError.tried`)', () => {
  const detail = 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none/sh": not executable';
  const failed = (tried: TerminalShellAttempt[] | undefined, message = detail) =>
    snap('failed', { cause: { stage: 'start', code: 'SHELL_UNAVAILABLE', message, ...(tried === undefined ? {} : { tried }) } });
  const attempt = (source: string, path: string, reason: string, said?: string): TerminalShellAttempt => ({ source, path, reason, ...(said === undefined ? {} : { detail: said }) });

  it('writes the typed words and then one line for each shell, in the order the host tried them, in the words of each token', () => {
    expect(
      failureLines(
        failed([
          attempt('requested', '/bin/zsh', 'not-found'),
          attempt('environment', '/opt/none/sh', 'not-executable'),
          attempt('account', '/usr/bin/fish', 'not-a-shell'),
          attempt('fallback', '/bin/sh', 'other', 'permission denied'),
        ]),
      ),
    ).toEqual([
      '[No shell could be started]',
      '[tried the shell asked for /bin/zsh: not found]',
      '[tried $SHELL /opt/none/sh: not executable]',
      '[tried the account\'s shell /usr/bin/fish: not a shell Omniview starts]',
      '[tried the fallback /bin/sh: permission denied]',
    ]);
  });

  it('says "failed" for an attempt that failed for another reason and told none', () => {
    expect(failureLines(failed([attempt('fallback', '/bin/sh', 'other')]))).toEqual(['[No shell could be started]', '[tried the fallback /bin/sh: failed]']);
    expect(failureLines(failed([attempt('fallback', '/bin/sh', 'other', '  ')]))).toEqual(['[No shell could be started]', '[tried the fallback /bin/sh: failed]']);
    expect(failureLines(failed([attempt('fallback', '/bin/sh', '')]))).toEqual(['[No shell could be started]', '[tried the fallback /bin/sh: failed]']);
  });

  it('says "a shell" for a source it does not know, and gives a reason it does not know as the token it was given', () => {
    expect(failureLines(failed([attempt('somewhere', '/bin/x', 'not-found')]))).toEqual(['[No shell could be started]', '[tried a shell /bin/x: not found]']);
    expect(failureLines(failed([attempt('requested', '/bin/x', 'permission-denied')]))).toEqual(['[No shell could be started]', '[tried the shell asked for /bin/x: permission-denied]']);
    expect(failureLines(failed([attempt('requested', '', 'not-found')]))).toEqual(['[No shell could be started]', '[tried the shell asked for: not found]']);
  });

  it('has the host\'s prose in a line of its own when it listed no attempt: the list is the prose, said one to a line', () => {
    expect(failureLines(failed(undefined))).toEqual(['[No shell could be started]', `[${detail}]`]);
    expect(failureLines(failed([]))).toEqual(['[No shell could be started]', `[${detail}]`]);
  });

  it('keeps the host\'s sentence as the reason of the card and the note of the lane, whether or not it listed the shells', () => {
    const tried = [attempt('requested', '/bin/zsh', 'not-found')];
    const sentence = `No shell could be started. ${detail}.`;
    expect(sessionStateOf(failed(tried))).toEqual({ state: 'failed', cause: sentence });
    expect(sessionStateOf(failed(undefined))).toEqual({ state: 'failed', cause: sentence });
    expect(laneOf(failed(tried))).toEqual({ words: 'Failed to start', note: sentence });
    expect(causeSentence({ stage: 'start', code: 'SHELL_UNAVAILABLE', message: detail, tried })).toBe(sentence);
  });

  it('lists nothing for a failure that did not happen at the start, whatever it carries', () => {
    expect(failureLines(snap('failed', { cause: { stage: 'session', message: 'x', tried: [attempt('requested', '/bin/zsh', 'not-found')] } }))).toEqual([]);
  });
});
