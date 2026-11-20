import { describe, expect, it } from 'vitest';
import type { Route, Session } from '../core/panel';
import { MAX_ACTIONS, cardOf, sinceWords } from './card';
import type { PanelCard } from './host';

// What the card of a session says (ch16 SCD1; the mock's `cardFor` in shell-panel.js): the plugin's description, completed with the host's defaults and cut to the rules: at most two
// buttons, Open <resource> first, a failure's reason, a state with its role and since when.

const NOW = new Date(2026, 10, 19, 14, 0, 0).getTime();
const at = (hour: number, minute = 0, day = 19) => new Date(2026, 10, day, hour, minute, 0).getTime();

const route: Route = { plugin: 'acme', contribution: 'item', params: { name: 'worker' } };
const session = (over: Partial<Session> = {}): Session => ({ id: 's1', tool: 'logs', plugin: 'acme', title: 'worker-7d8c6f49b', scope: '', state: 'running', since: at(8, 41), cause: '', ...over });
const tool = { label: 'Logs', icon: 'box' };
const noop = () => undefined;

describe('when it was', () => {
  it('is the time for today, "yesterday" and the time for the day before, and the date and the time before that', () => {
    expect(sinceWords(at(8, 41), NOW)).toBe('08:41');
    expect(sinceWords(at(23, 5, 18), NOW)).toBe('yesterday 23:05');
    expect(sinceWords(at(9, 0, 14), NOW)).toBe('Nov 14 09:00');
  });

  it('is nothing for a time that is not one', () => {
    expect(sinceWords(0, NOW)).toBe('');
    expect(sinceWords(Number.NaN, NOW)).toBe('');
  });
});

describe('a session with no description of its own gets the host\'s', () => {
  it('names the kind and the glyph of its tool, its state with the role the state has and since when, and no button', () => {
    const card = cardOf(session(), tool, undefined, NOW);
    expect(card).toMatchObject({ kind: 'Logs', icon: 'box', resource: undefined, facts: [], state: { label: 'Running', role: 'running', since: '08:41', reason: '' }, actions: [] });
  });

  it('gives every state its word and its role', () => {
    const roles = (['starting', 'running', 'ended', 'failed'] as const).map((state) => cardOf(session({ state }), tool, undefined, NOW).state);
    expect(roles.map((state) => [state.label, state.role])).toEqual([['Starting', 'progress'], ['Running', 'running'], ['Ended', 'stopped'], ['Failed', 'error']]);
  });

  it('shows a resource link when the session belongs to one: its title, as the resource, and a button that opens it', () => {
    const card = cardOf(session({ route }), tool, undefined, NOW);
    expect(card.resource).toEqual({ label: 'worker-7d8c6f49b', kind: '', icon: undefined, route });
    expect(card.actions.map((action) => action.label)).toEqual(['Open resource']);
    expect(card.actions[0]).toMatchObject({ opens: true });
  });

  it('says why a session ended or failed, in a sentence', () => {
    expect(cardOf(session({ state: 'failed', cause: 'The source did not answer' }), tool, undefined, NOW).state.reason).toBe('The source did not answer.');
    expect(cardOf(session({ state: 'ended', cause: 'The plugin was unloaded.' }), tool, undefined, NOW).state.reason).toBe('The plugin was unloaded.');
    expect(cardOf(session({ state: 'running', cause: '' }), tool, undefined, NOW).state.reason).toBe('');
  });
});

describe('what the plugin says wins, member by member', () => {
  const given: PanelCard = {
    kind: 'Stream',
    icon: 'server',
    resource: { label: 'Item worker', kind: 'Item', icon: 'layers', route },
    facts: [['Connection', 'north'], ['Group', '']],
    state: { label: 'Streaming', reason: 'Reading the source.' },
    actions: [{ label: 'Stop', onSelect: noop }, { label: 'Copy', onSelect: noop }],
  };

  it('takes the kind, the glyph, the resource, the facts, the state\'s words and the reason', () => {
    const card = cardOf(session({ route }), tool, given, NOW);
    expect(card.kind).toBe('Stream');
    expect(card.icon).toBe('server');
    expect(card.resource).toEqual({ label: 'Item worker', kind: 'Item', icon: 'layers', route });
    expect(card.facts).toEqual([['Connection', 'north']]);
    expect(card.state).toEqual({ label: 'Streaming', role: 'running', since: '08:41', reason: 'Reading the source.' });
  });

  it('shows at most two buttons in all, Open <resource> first when the resource has a route', () => {
    expect(MAX_ACTIONS).toBe(2);
    const card = cardOf(session({ route }), tool, given, NOW);
    expect(card.actions.map((action) => action.label)).toEqual(['Open Item', 'Stop']);
    expect(card.actions[0]?.opens).toBe(true);
    expect(cardOf(session(), tool, { ...given, resource: { label: 'Item worker' } }, NOW).actions.map((action) => action.label)).toEqual(['Stop', 'Copy']);
  });

  it('a resource with no route is text, not a link, and has no Open button', () => {
    const card = cardOf(session(), tool, { resource: { label: 'Item worker', kind: 'Item' } }, NOW);
    expect(card.resource?.route).toBeUndefined();
    expect(card.actions).toEqual([]);
  });

  it('a failed session\'s reason is the plugin\'s next step, or its own cause', () => {
    const failed = session({ state: 'failed', cause: 'The source did not answer.' });
    expect(cardOf(failed, tool, { actions: [{ label: 'Retry', onSelect: noop }] }, NOW).state.reason).toBe('The source did not answer.');
    expect(cardOf(failed, tool, { state: { reason: 'Check the address, then retry.' } }, NOW).state.reason).toBe('Check the address, then retry.');
  });

  it('keeps an action\'s reason and drops an action with no label', () => {
    const card = cardOf(session(), tool, { actions: [{ label: '', onSelect: noop }, { label: 'Stop', onSelect: noop, disabledReason: 'Stopping' }] }, NOW);
    expect(card.actions).toEqual([{ label: 'Stop', icon: undefined, onSelect: noop, disabledReason: 'Stopping', opens: false }]);
  });

  it('survives a description that is not one: a blank member is the host\'s default', () => {
    const card = cardOf(session(), tool, { kind: '  ', state: { label: '' }, facts: [['', 'x']] }, NOW);
    expect(card).toMatchObject({ kind: 'Logs', state: { label: 'Running' }, facts: [] });
  });
});

// A21: the sessions of a tool of the host are kept while their plugin is off, whatever their state, and what needs the plugin cannot work: the way back to the resource is a page of that plugin. The reason is
// always the unload's sentence, "The plugin was unloaded.": printed on the card (it is the session's own cause when the unload ended it, and the card adds it after the stream's own words when the session had
// ended or failed on its own), and it is the reason of the button that opens the resource; the resource's name is text, as a resource with no route is.
describe('a session whose plugin is off (a session of a tool of the host, kept: A21)', () => {
  const UNLOADED = 'The plugin was unloaded.';
  const held = (over: Partial<Session> = {}): Session => session({ state: 'ended', cause: UNLOADED, held: true, route, ...over });
  const named: PanelCard = { resource: { label: 'Item worker', kind: 'Item', icon: 'layers', route } };

  it('says why it ended and disables the way back to the resource with that reason: the name is not a link, and Open <resource> is unavailable for the same sentence', () => {
    const card = cardOf(held(), tool, named, NOW, true);
    expect(card.state).toMatchObject({ label: 'Ended', role: 'stopped', reason: UNLOADED });
    expect(card.resource).toEqual({ label: 'Item worker', kind: 'Item', icon: 'layers', route, disabledReason: UNLOADED });
    expect(card.actions).toEqual([{ label: 'Open Item', icon: undefined, onSelect: expect.any(Function), disabledReason: UNLOADED, opens: true }]);
  });

  it('works again when the plugin is back: the same session, the link and the button have no reason', () => {
    const card = cardOf(held(), tool, named, NOW, false);
    expect(card.state.reason).toBe(UNLOADED);
    expect(card.resource?.disabledReason).toBeUndefined();
    expect(card.actions[0]).toMatchObject({ label: 'Open Item', disabledReason: undefined, opens: true });
  });

  it('has the reason a card with no description of the plugin\'s gives too: the session\'s title is the resource, and it cannot be opened', () => {
    const card = cardOf(held(), tool, undefined, NOW, true);
    expect(card.resource).toMatchObject({ label: 'worker-7d8c6f49b', route, disabledReason: UNLOADED });
    expect(card.actions).toEqual([expect.objectContaining({ label: 'Open resource', disabledReason: UNLOADED, opens: true })]);
  });

  it('disables nothing that was not a link: a resource with no route is text already and has no button, and the plugin\'s own buttons are the plugin\'s', () => {
    const plain = cardOf(held({ route: undefined }), tool, { resource: { label: 'Item worker', kind: 'Item' } }, NOW, true);
    expect(plain.resource?.disabledReason).toBeUndefined();
    expect(plain.actions).toEqual([]);
    const own = cardOf(held(), tool, { ...named, actions: [{ label: 'Copy', onSelect: noop }] }, NOW, true);
    expect(own.actions.map((action) => [action.label, action.disabledReason])).toEqual([['Open Item', UNLOADED], ['Copy', undefined]]);
  });

  it('is disabled even when the session says nothing of why it ended: it had ended on its own, so the card says the plugin was unloaded while it is, and says nothing of it once it is back', () => {
    const off = cardOf(held({ cause: '' }), tool, named, NOW, true);
    expect(off.state.reason).toBe(UNLOADED);
    expect(off.actions[0]?.disabledReason).toBe(UNLOADED);
    expect(off.resource?.disabledReason).toBe(UNLOADED);
    expect(cardOf(held({ cause: '' }), tool, named, NOW, false).state.reason).toBe('');
  });

  it('says what a session that had failed on its own says of itself, and then that the plugin was unloaded; the button is unavailable for the second sentence, and the first stands alone when the plugin is back', () => {
    const failed = held({ state: 'failed', cause: 'The log stream stopped. The source did not answer.' });
    const off = cardOf(failed, tool, named, NOW, true);
    expect(off.state).toMatchObject({ label: 'Failed', role: 'error', reason: `The log stream stopped. The source did not answer. ${UNLOADED}` });
    expect(off.actions[0]?.disabledReason).toBe(UNLOADED);
    const back = cardOf(failed, tool, named, NOW, false);
    expect(back.state.reason).toBe('The log stream stopped. The source did not answer.');
    expect(back.actions[0]?.disabledReason).toBeUndefined();
  });

  it('changes nothing for a session whose plugin is live: it is never disabled', () => {
    const card = cardOf(session({ route }), tool, named, NOW);
    expect(card.resource?.disabledReason).toBeUndefined();
    expect(card.actions[0]?.disabledReason).toBeUndefined();
  });
});
