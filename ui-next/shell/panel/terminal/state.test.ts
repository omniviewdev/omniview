import { describe, expect, it } from 'vitest';
import type { TerminalFeedCause, TerminalFeedSnapshot } from './feed';
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
