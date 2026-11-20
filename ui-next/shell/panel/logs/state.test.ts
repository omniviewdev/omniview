import type { LogFeedCause } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { causeSentence, sessionStateOf, stateWords } from './state';

// What a feed says about itself, as the panel's session says it: the panel has four states (`starting`, `running`, `ended`, `failed`) and a feed has five (`paused` is the reader's and the feed's own,
// not a state of the work), so a paused feed is a running session and `paused` is a fact of the card.

const snapshot = (state: 'starting' | 'streaming' | 'paused' | 'ended' | 'failed', extra: { readonly paused?: boolean; readonly cause?: LogFeedCause } = {}) => ({
  state,
  paused: extra.paused ?? state === 'paused',
  cause: extra.cause,
});

describe('the state of the session a feed is', () => {
  it.each([
    ['starting', 'starting'],
    ['streaming', 'running'],
    ['paused', 'running'],
    ['ended', 'ended'],
  ] as const)('maps a feed that is %s to a session that is %s, with no cause', (feed, session) => {
    expect(sessionStateOf(snapshot(feed))).toEqual({ state: session, cause: '' });
  });

  it('keeps a session that ended while the reader had paused it ended: the end is the work\'s, the pause is the reader\'s', () => {
    expect(sessionStateOf(snapshot('ended', { paused: true }))).toEqual({ state: 'ended', cause: '' });
  });

  it('maps a failure to a failed session with the cause as a sentence', () => {
    expect(sessionStateOf(snapshot('failed', { cause: { stage: 'source', source: 'orders-api/app', message: 'Failed to reconnect after 5 attempts' } }))).toEqual({
      state: 'failed',
      cause: 'The log stream stopped. Failed to reconnect after 5 attempts.',
    });
  });

  it('says it never started when the creation failed, as the view says it', () => {
    expect(sessionStateOf(snapshot('failed', { cause: { stage: 'create', message: 'forbidden: you may not read this log.' } }))).toEqual({
      state: 'failed',
      cause: 'Couldn\'t start the log stream. forbidden: you may not read this log.',
    });
  });

  it('gives a failure with no cause a sentence too, so the card is never left with a blank reason', () => {
    expect(sessionStateOf(snapshot('failed'))).toEqual({ state: 'failed', cause: 'The log stream stopped. The source gave no reason.' });
  });
});

describe('the cause of a failure as a sentence', () => {
  it('ends the source\'s own words with a full stop when they have none, and leaves other endings alone', () => {
    expect(causeSentence({ stage: 'session', message: 'The session was refused' })).toBe('The log stream stopped. The session was refused.');
    expect(causeSentence({ stage: 'session', message: 'Is the service running?' })).toBe('The log stream stopped. Is the service running?');
    expect(causeSentence({ stage: 'session', message: '   ' })).toBe('The log stream stopped. The source gave no reason.');
  });
});

describe('the words of a session on its card', () => {
  it('are the ones the mock says for a log: Connecting, Streaming, Stream ended, Failed (to start)', () => {
    expect(stateWords('starting', undefined)).toBe('Connecting');
    expect(stateWords('running', undefined)).toBe('Streaming');
    expect(stateWords('ended', undefined)).toBe('Stream ended');
    expect(stateWords('failed', { stage: 'source', message: 'x' })).toBe('Failed');
    expect(stateWords('failed', { stage: 'session', message: 'x' })).toBe('Failed');
    expect(stateWords('failed', { stage: 'create', message: 'x' })).toBe('Failed to start');
    expect(stateWords('failed', undefined)).toBe('Failed');
  });
});
