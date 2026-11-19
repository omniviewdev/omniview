import { describe, expect, it } from 'vitest';
import { UNLOADED_CAUSE, type Session } from '../../core/panel';
import { cardOf } from '../card';
import { completeLogCard, logCardOf } from './card';
import type { LogSessionRecord } from './LogStreams';

// What the hover card of a Logs session says (ch16 SCD1; the mock's `cardFor`): the kind, the resource as a link, the facts between the resource and the state (the sources, and that the reader paused),
// and the state in the words of a log. The host owns it: a plugin tells it what it must know (its resource) when it opens the session. The shell completes it (`../card.ts`): `Open <resource>` first,
// the session's cause as the reason of a failure, at most two buttons.

const session = (patch: Partial<Session> = {}): Session => ({ id: 's1', tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north', state: 'running', since: 0, cause: '', ...patch });

const record = (patch: Partial<LogSessionRecord> = {}): LogSessionRecord => ({
  id: 'item/orders-api/app',
  plugin: 'acme',
  resource: { label: 'Item orders-api', kind: 'Item', icon: 'layers', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } },
  snapshot: { state: 'streaming', paused: false, cause: undefined },
  ...patch,
});

const TOOL = { label: 'Logs', icon: 'scroll-text' };

describe('the card of a Logs session', () => {
  it('is a Logs card: its kind, its glyph and the resource it belongs to, as a link to the resource\'s page', () => {
    const card = logCardOf(session(), record());
    expect(card.kind).toBe('Logs');
    expect(card.icon).toBe('scroll-text');
    expect(card.resource).toEqual({ label: 'Item orders-api', kind: 'Item', icon: 'layers', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } });
  });

  it('makes the route a route of the tab model, whatever way the plugin spelled it', () => {
    const card = logCardOf(session(), record({ resource: { label: 'Item orders-api', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api', zone: 'x' } } } }));
    expect(card.resource?.route).toMatchObject({ plugin: 'acme', contribution: 'item', params: { name: 'orders-api', zone: 'x' } });
  });

  it('is text, not a link, for a resource whose route the model does not know (a plain label stays)', () => {
    const card = logCardOf(session(), record({ resource: { label: 'Item orders-api', route: { plugin: '', contribution: '' } } }));
    expect(card.resource).toMatchObject({ label: 'Item orders-api' });
    expect(card.resource?.route).toBeUndefined();
  });

  it('names the one source of a session, and lists several (three, then how many more)', () => {
    expect(logCardOf(session(), record({ snapshot: { state: 'streaming', paused: false, cause: undefined, sources: [{ id: 'orders-api/app' }] } })).facts).toEqual([['Source', 'orders-api/app']]);
    expect(logCardOf(session(), record({ snapshot: { state: 'streaming', paused: false, cause: undefined, sources: [{ id: 'a' }, { id: 'b' }] } })).facts).toEqual([['Sources', 'a, b']]);
    expect(
      logCardOf(session(), record({ snapshot: { state: 'streaming', paused: false, cause: undefined, sources: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })) } })).facts,
    ).toEqual([['Sources', 'a, b, c and 2 more']]);
  });

  it('says nothing of sources a feed does not list: a fact with no text is left out', () => {
    expect(logCardOf(session(), record()).facts).toEqual([]);
    expect(logCardOf(session(), record({ snapshot: { state: 'streaming', paused: false, cause: undefined, sources: [] } })).facts).toEqual([]);
  });

  it('says that the reader paused it, as a fact: the session is still running', () => {
    const card = logCardOf(session(), record({ snapshot: { state: 'paused', paused: true, cause: undefined, sources: [{ id: 'orders-api/app' }] } }));
    expect(card.facts).toEqual([['Source', 'orders-api/app'], ['Paused', 'Yes']]);
    expect(card.state?.label).toBe('Streaming');
  });

  it('does not say paused of a session that is over: the pause outlives the end in the feed, and means nothing then', () => {
    const ended = logCardOf(session({ state: 'ended' }), record({ snapshot: { state: 'ended', paused: true, cause: undefined } }));
    expect(ended.facts).toEqual([]);
    const failed = logCardOf(session({ state: 'failed', cause: 'The log stream stopped. x.' }), record({ snapshot: { state: 'failed', paused: true, cause: { stage: 'source', message: 'x' } } }));
    expect(failed.facts).toEqual([]);
  });

  it('words the state as the mock does for a log, and a creation that failed as one that never started', () => {
    expect(logCardOf(session({ state: 'starting' }), record({ snapshot: { state: 'starting', paused: false, cause: undefined } })).state?.label).toBe('Connecting');
    expect(logCardOf(session({ state: 'running' }), record()).state?.label).toBe('Streaming');
    expect(logCardOf(session({ state: 'ended' }), record({ snapshot: { state: 'ended', paused: false, cause: undefined } })).state?.label).toBe('Stream ended');
    expect(logCardOf(session({ state: 'failed' }), record({ snapshot: { state: 'failed', paused: false, cause: { stage: 'source', message: 'x' } } })).state?.label).toBe('Failed');
    expect(logCardOf(session({ state: 'failed' }), record({ snapshot: { state: 'failed', paused: false, cause: { stage: 'create', message: 'x' } } })).state?.label).toBe('Failed to start');
  });

  it('brings no button of its own: the shell adds `Open <resource>`, and a Logs session has nothing else the host can do for it (at most two, whatever is added)', () => {
    expect(logCardOf(session(), record()).actions).toBeUndefined();
  });

  it('is still a card for a session the registry holds no stream for (one restored from the last run, or whose plugin came back): the words of an ended log, and the resource the session itself remembers', () => {
    const card = logCardOf(session({ state: 'ended', cause: 'Restored from the last session.', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } }), undefined);
    expect(card).toMatchObject({ kind: 'Logs', icon: 'scroll-text', state: { label: 'Stream ended' } });
    expect(card.resource).toBeUndefined();
    const resolved = cardOf(session({ state: 'ended', cause: 'Restored from the last session.', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } }), TOOL, card, Date.now());
    expect(resolved.resource).toMatchObject({ label: 'orders-api/app' });
    expect(resolved.state.reason).toBe('Restored from the last session.');
  });
});

describe('the card as the shell completes it', () => {
  it('opens with `Open Item` first, shows the plugin\'s resource and the failure\'s reason, and never more than two buttons', () => {
    const failed = session({ state: 'failed', cause: 'The log stream stopped. Failed to reconnect after 5 attempts.' });
    const resolved = cardOf(failed, TOOL, logCardOf(failed, record({ snapshot: { state: 'failed', paused: false, cause: { stage: 'source', message: 'x' } } })), Date.now());
    expect(resolved.kind).toBe('Logs');
    expect(resolved.resource?.label).toBe('Item orders-api');
    expect(resolved.actions.map((action) => action.label)).toEqual(['Open Item']);
    expect(resolved.state).toMatchObject({ label: 'Failed', role: 'error', reason: 'The log stream stopped. Failed to reconnect after 5 attempts.' });
  });

  it('says why a session ended when its plugin was unloaded, and not only that it ended: the cause the panel wrote is the reason the card gives, for the session that comes back with its plugin', () => {
    const unloaded = session({ state: 'ended', cause: UNLOADED_CAUSE });
    const resolved = cardOf(unloaded, TOOL, logCardOf(unloaded, undefined), Date.now());
    expect(resolved.state).toMatchObject({ label: 'Stream ended', role: 'stopped', reason: 'The plugin was unloaded.' });
  });
});

describe('the host\'s card completed by the plugin\'s', () => {
  it('keeps the host\'s members where the plugin leaves them out: an own key holding `undefined`, as the plugin handle writes the members a plugin did not give, does not erase the host\'s', () => {
    const host = logCardOf(session(), record({ snapshot: { state: 'streaming', paused: false, cause: undefined, sources: [{ id: 'orders-api/app' }] } }));
    const completed = completeLogCard(host, { kind: undefined, icon: undefined, resource: undefined, facts: undefined, state: undefined, actions: [{ label: 'Copy name', icon: undefined, onSelect: () => undefined, disabledReason: undefined }] });
    expect(completed).toMatchObject({ kind: 'Logs', icon: 'scroll-text', resource: { label: 'Item orders-api' }, facts: [['Source', 'orders-api/app']], state: { label: 'Streaming' } });
    expect(completed.actions).toHaveLength(1);
  });

  it('lets the plugin\'s words win where it gives them, and is the host\'s card when the plugin gives none', () => {
    const host = logCardOf(session(), record());
    expect(completeLogCard(host, { kind: 'Stream', facts: [['Source', 'x']] })).toMatchObject({ kind: 'Stream', facts: [['Source', 'x']], icon: 'scroll-text' });
    expect(completeLogCard(host, undefined)).toBe(host);
  });
});
