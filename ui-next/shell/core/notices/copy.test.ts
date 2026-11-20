import { describe, expect, it } from 'vitest';
import { failedTitle, foldNote, headline, laneText, present, sentenceOf, stateWord, type Phrase } from './copy';
import type { ActionView } from './types';

// One function behind every rendering of a record (S75): the headline, the state word, the second line and the one sentence a compact rendering shows. The mock's `present`, `headline`,
// `failedTitle`, `foldNote`, `laneText`, `stateWord` (shell-notify.js:381-418, 790-815) with its tables of verbs and nouns, less the words of a plugin's domain: the model is plugin-agnostic.

const phrase = (extra: Partial<Phrase> = {}): Phrase => ({
  kind: 'operation',
  state: 'running',
  severity: 'info',
  source: 'cloud',
  sourceName: 'Cloud',
  title: 'Restarting api-gateway',
  doneTitle: '',
  detail: '',
  target: undefined,
  progress: null,
  cancellation: 'unsupported',
  cancelLabel: '',
  attempt: 1,
  count: 1,
  fold: '',
  ...extra,
});

const action = (extra: Partial<ActionView> & Pick<ActionView, 'id' | 'kind' | 'label'>): ActionView => ({ variant: 'default', icon: '', danger: false, disabled: '', route: undefined, command: undefined, ...extra });

describe('failedTitle: what failed, in the past tense, with no "Failed ·" prefix (X3)', () => {
  it('turns the gerund a title starts with into "Couldn\'t …"', () => {
    expect(failedTitle('Connecting to prod-db')).toBe('Couldn\'t connect to prod-db');
    expect(failedTitle('Installing plugin cloud')).toBe('Couldn\'t install plugin cloud');
    expect(failedTitle('Scaling api-gateway to 3')).toBe('Couldn\'t scale api-gateway to 3');
  });

  it('reads two words first: "Rolling back" and "Backing up" are one verb', () => {
    expect(failedTitle('Rolling back api-gateway')).toBe('Couldn\'t roll back api-gateway');
    expect(failedTitle('Backing up vm-104')).toBe('Couldn\'t back up vm-104');
  });

  it('leaves a title that does not start with a known gerund as it was', () => {
    expect(failedTitle('Disk usage is high')).toBe('');
    expect(failedTitle('Reconnect failed')).toBe('');
    expect(failedTitle('')).toBe('');
  });

  it('keeps the title within its bound', () => {
    expect(failedTitle(`Connecting to ${'x'.repeat(100)}`).length).toBeLessThanOrEqual(80);
  });
});

describe('headline: the title a person reads', () => {
  it('is the done title of work that succeeded (OF3: the verb and the object)', () => {
    expect(headline(phrase({ state: 'succeeded', doneTitle: 'Restarted api-gateway' }))).toBe('Restarted api-gateway');
  });

  it('is the title while the work is active or when it has no done title', () => {
    expect(headline(phrase())).toBe('Restarting api-gateway');
    expect(headline(phrase({ state: 'succeeded' }))).toBe('Restarting api-gateway');
  });

  it('says "Couldn\'t …" for work that failed, once only', () => {
    expect(headline(phrase({ state: 'failed', title: 'Connecting to prod-db' }))).toBe('Couldn\'t connect to prod-db');
    expect(headline(phrase({ state: 'failed', title: 'Connecting to prod-db', count: 2 }))).not.toBe('Couldn\'t connect to prod-db');
  });

  it('is the title of a message', () => {
    expect(headline(phrase({ kind: 'message', state: 'succeeded', title: 'Snapshot created' }))).toBe('Snapshot created');
  });

  it('says a message again as "title N times" (S79)', () => {
    expect(headline(phrase({ kind: 'message', state: 'succeeded', title: 'Snapshot created', fold: 'repeat', count: 3 }))).toBe('Snapshot created 3 times');
  });

  it('says a group in words: what happened and how many times ("5 connections failed")', () => {
    const group = { kind: 'message', state: 'succeeded', severity: 'error', fold: 'group', count: 5, title: 'Connecting to replica 5' } as const;
    expect(headline(phrase(group))).toBe('5 connections failed');
    expect(headline(phrase({ ...group, severity: 'success', title: 'Installing plugin cloud', count: 3 }))).toBe('3 installs finished');
    expect(headline(phrase({ ...group, target: { label: 'x', kind: 'sync', route: undefined, removed: false }, count: 2, severity: 'warning' }))).toBe('2 syncs need attention');
  });

  it('says a group of notices that share only a source by its source', () => {
    expect(headline(phrase({ kind: 'message', state: 'succeeded', severity: 'info', fold: 'group', count: 5, title: 'Something happened' }))).toBe('5 notifications from Cloud');
  });

  it('keeps the title of a keyed notice and of the row of a source that posts too much: their note says the count', () => {
    expect(headline(phrase({ kind: 'message', state: 'succeeded', severity: 'error', fold: 'key', count: 4, title: 'Lost the connection' }))).toBe('Lost the connection');
    expect(headline(phrase({ kind: 'message', state: 'succeeded', severity: 'warning', fold: 'rate', count: 30, title: 'Cloud is posting many notifications' }))).toBe('Cloud is posting many notifications');
  });

  it('is bounded to eighty characters however long the pieces are', () => {
    expect(headline(phrase({ kind: 'message', state: 'succeeded', fold: 'repeat', count: 12, title: 'x'.repeat(80) })).length).toBeLessThanOrEqual(80);
  });
});

describe('foldNote and laneText: the second line', () => {
  it('names the latest of a group, and how often a key happened', () => {
    expect(foldNote(phrase({ kind: 'message', state: 'succeeded', fold: 'group', count: 3, title: 'Node 3 is under pressure', detail: 'Evicting 1 job' }))).toBe('Latest: Node 3 is under pressure — Evicting 1 job');
    expect(foldNote(phrase({ kind: 'message', state: 'succeeded', fold: 'key', count: 4, detail: 'Nothing answered' }))).toBe('Happened 4 times · Nothing answered');
    expect(foldNote(phrase({ kind: 'message', state: 'succeeded', fold: 'key', count: 4 }))).toBe('Happened 4 times');
    expect(foldNote(phrase())).toBe('');
  });

  it('is the message, the step while a step runs, or what to check when the outcome is unknown', () => {
    expect(laneText(phrase({ detail: 'Draining the first node' }))).toBe('Draining the first node');
    expect(laneText(phrase({ progress: { kind: 'steps', current: 2, total: 5, label: 'Download', steps: undefined } }))).toBe('Download');
    expect(laneText(phrase({ progress: { kind: 'steps', current: 2, total: 5, label: 'Download', steps: undefined }, detail: 'Fetching' }))).toBe('Fetching');
    expect(laneText(phrase({ state: 'unknown', target: { label: 'api-gateway', kind: '', route: undefined, removed: false } }))).toBe('Check api-gateway.');
    expect(laneText(phrase({ state: 'unknown', detail: 'The plugin stopped.' }))).toBe('Check the target. The plugin stopped.');
  });
});

describe('stateWord', () => {
  it('names the states that need a word', () => {
    expect(stateWord(phrase({ state: 'queued' }))).toBe('Queued');
    expect(stateWord(phrase({ state: 'paused' }))).toBe('Paused');
    expect(stateWord(phrase({ state: 'cancelled' }))).toBe('Canceled');
    expect(stateWord(phrase({ state: 'unknown' }))).toBe('Outcome unknown.');
  });

  it('says nothing for running, succeeded and failed: the glyph and the headline say it', () => {
    expect(stateWord(phrase())).toBe('');
    expect(stateWord(phrase({ state: 'succeeded' }))).toBe('');
    expect(stateWord(phrase({ state: 'failed' }))).toBe('');
  });

  it('counts a second attempt, and says Canceling… until the producer acknowledges (S84), Stopping… for a Stop', () => {
    expect(stateWord(phrase({ attempt: 2 }))).toBe('Attempt 2');
    expect(stateWord(phrase({ cancellation: 'requested' }))).toBe('Canceling…');
    expect(stateWord(phrase({ cancellation: 'acknowledged', cancelLabel: 'Stop forwarding' }))).toBe('Stopping…');
  });
});

describe('sentenceOf: a full sentence', () => {
  it('has a capital and ends with a period; a text that ends a sentence keeps its mark', () => {
    expect(sentenceOf('not available after restart')).toBe('Not available after restart.');
    expect(sentenceOf('Done!')).toBe('Done!');
    expect(sentenceOf('  ')).toBe('');
  });
});

describe('present: the one place every rendering reads', () => {
  it('draws a running operation as its state word and text, and a finished one as the headline and the effect (OF3)', () => {
    expect(present(phrase({ detail: 'Draining the first node' }), []).phase).toBe('Draining the first node');
    expect(present(phrase({ state: 'queued' }), []).phase).toBe('Queued');
    expect(present(phrase({ state: 'queued', detail: 'Waiting for a slot' }), []).phase).toBe('Queued · Waiting for a slot');
    expect(present(phrase({ state: 'succeeded', title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', detail: '3 replicas are ready' }), []).phase).toBe('Scaled orders-api. 3 replicas are ready');
    expect(present(phrase({ state: 'succeeded', title: 'Scaling orders-api', doneTitle: 'Scaled orders-api.' }), []).phase).toBe('Scaled orders-api.');
  });

  it('says a failure with its cause', () => {
    expect(present(phrase({ state: 'failed', title: 'Connecting to prod-db', detail: 'Nothing answered on port 9090. Check that it is running.' }), []).phase).toBe('Couldn\'t connect to prod-db. Nothing answered on port 9090. Check that it is running.');
  });

  it('says in words why a command cannot be used, under the text, and never for a Cancel that waits (X9)', () => {
    const blocked = [action({ id: 'retry', kind: 'retry', label: 'Retry', disabled: 'Not available after restart' })];
    const read = present(phrase({ state: 'failed', title: 'Connecting to prod-db' }), blocked);
    expect(read.reason).toBe('Retry is unavailable. Not available after restart.');
    expect(read.phase).toContain('Retry is unavailable. Not available after restart.');
    const waiting = [action({ id: 'cancel', kind: 'cancel', label: 'Canceling…', disabled: 'Requested. Waiting for the producer to acknowledge.' })];
    expect(present(phrase({ cancellation: 'requested' }), waiting).reason).toBe('');
  });

  it('reads the same everywhere: the title, the word, the text and the phase are one answer', () => {
    const read = present(phrase({ state: 'cancelled', detail: 'Stopped after 20 of 40 GiB' }), []);
    expect(read.title).toBe('Restarting api-gateway');
    expect(read.word).toBe('Canceled');
    expect(read.text).toBe('Stopped after 20 of 40 GiB');
    expect(read.phase).toBe('Canceled · Stopped after 20 of 40 GiB');
  });

  it('gives a group no state word: its note says what it stands for', () => {
    const read = present(phrase({ kind: 'message', state: 'succeeded', severity: 'error', fold: 'group', count: 5, title: 'Connecting to replica 5', detail: 'Timed out' }), []);
    expect(read.word).toBe('');
    expect(read.title).toBe('5 connections failed');
    expect(read.text).toBe('Latest: Connecting to replica 5 — Timed out');
  });
});
