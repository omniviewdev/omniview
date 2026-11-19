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
