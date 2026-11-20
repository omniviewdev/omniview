import { describe, expect, it } from 'vitest';
import { declareActions, resolveActions, type ResolveInput } from './actions';
import type { ActionInput, Target } from './types';

// The actions of a record (S74, S84, RC1; the mock's `normActions` and `resolveActions`, shell-notify.js:152-166, 420-460): at most four; each acts by DATA (a route, a command id) or by the
// producer's own code; the model adds Cancel; the order, the variant and the reason a command cannot be used are decided once, here, for every surface (X1). A function that cannot run
// stays visible and says why, and never stands as a dead button (ch05 RC1).

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };
const run = (): undefined => undefined;

const resolved = (extra: Partial<ResolveInput> = {}) => resolveActions({
  state: 'failed',
  cancellation: 'unsupported',
  target: undefined,
  decls: [],
  handlers: { cancel: false, retry: false, has: () => false },
  dead: '',
  availability: () => ({ state: 'available' }),
  commandAvailability: () => ({ state: 'available' }),
  current: () => false,
  ...extra,
});

const declared = (list: readonly ActionInput[]) => declareActions(list).decls;

describe('declareActions: what a producer wrote, as data', () => {
  it('keeps at most four, each with an id and a label, and drops one that repeats an id', () => {
    const { decls } = declareActions([
      { id: 'a', label: 'A', run },
      { id: 'a', label: 'again', run },
      { label: 'No id', run },
      { id: 'b', label: 'B', run },
      { id: 'c', label: 'C', run },
      { id: 'd', label: 'D', run },
    ]);
    expect(decls.map((decl) => decl.id)).toEqual(['a', 'action-1', 'b', 'c']);
  });

  it('names an action by its kind when it has no label, and bounds a label to twenty-four characters', () => {
    const { decls } = declareActions([{ kind: 'retry', run }, { id: 'x', label: 'L'.repeat(40), run }]);
    expect(decls[0]).toMatchObject({ id: 'retry', kind: 'retry', label: 'Retry' });
    expect(decls[1]?.label).toHaveLength(24);
  });

  it('acts by one of three ways, and the kind follows: a route opens, a command and code are custom', () => {
    const { decls } = declareActions([{ id: 'go', label: 'Open it', route }, { id: 'cmd', label: 'Sign in', command: { id: 'host.signIn', arg: { a: 1 } } }, { id: 'code', label: 'Fix', run }]);
    expect(decls.map((decl) => [decl.id, decl.kind, decl.route !== undefined, decl.command !== undefined, decl.code])).toEqual([
      ['go', 'open', true, false, false],
      ['cmd', 'custom', false, true, false],
      ['code', 'custom', false, false, true],
    ]);
  });

  it('refuses an action with no way to act, and one with two: a button must do the one thing it says', () => {
    const { decls, problems } = declareActions([{ id: 'none', label: 'Nothing' }, { id: 'two', label: 'Two', route, command: { id: 'x' } }, { id: 'ok', label: 'Ok', run }]);
    expect(decls.map((decl) => decl.id)).toEqual(['ok']);
    expect(problems).toHaveLength(2);
  });

  it('keeps a Retry with no way of its own (the producer\'s onRetry acts) and a Cancel that only relabels', () => {
    const { decls } = declareActions([{ kind: 'retry' }, { kind: 'cancel', label: 'Stop' }]);
    expect(decls.map((decl) => decl.kind)).toEqual(['retry', 'cancel']);
  });

  it('refuses a route that is not valid data and a command with no id', () => {
    const { decls, problems } = declareActions([{ id: 'r', label: 'R', route: { plugin: '', contribution: 'x' } }, { id: 'c', label: 'C', command: { id: '  ' } }, { id: 'ok', label: 'Ok', run }]);
    expect(decls.map((decl) => decl.id)).toEqual(['ok']);
    expect(problems).toHaveLength(2);
  });

  it('keeps the first Open as the Open; a later one is a command like any other', () => {
    const { decls } = declareActions([{ id: 'o1', route }, { id: 'o2', route: { plugin: 'cloud', contribution: 'volumes' } }]);
    expect(decls.map((decl) => decl.kind)).toEqual(['open', 'custom']);
  });

  it('copies a route and a command as plain data it owns', () => {
    const input = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };
    const { decls } = declareActions([{ id: 'go', route: input }]);
    input.params.id = 'changed';
    expect(decls[0]?.route?.params).toEqual({ id: 'i-1' });
    expect(Object.isFrozen(decls[0]?.route)).toBe(true);
  });

  it('says "Not available" for a command that is disabled without a reason, and bounds the reason', () => {
    const { decls } = declareActions([{ id: 'a', run, disabled: true }, { id: 'b', run, disabled: 'x'.repeat(200) }, { id: 'c', run }]);
    expect(decls.map((decl) => decl.disabled.length)).toEqual(['Not available'.length, 80, 0]);
  });

  it('hands back the code it was given, by id, and keeps none of it in the data', () => {
    const own = (): string => 'ran';
    const result = declareActions([{ id: 'a', label: 'A', run: own }, { id: 'go', route }]);
    expect(result.runs.get('a')).toBe(own);
    expect(result.runs.has('go')).toBe(false);
    expect(JSON.stringify(result.decls)).not.toContain('ran');
  });

  it('is total: anything but a list is no actions', () => {
    expect(declareActions(undefined).decls).toEqual([]);
    expect(declareActions('x').decls).toEqual([]);
    expect(declareActions([null, 4, 'x']).decls).toEqual([]);
  });
});

describe('resolveActions: the order, the variant and the reason', () => {
  it('draws Cancel first while the work runs, only when the producer can cancel (S84)', () => {
    const decls = declared([{ id: 'logs', label: 'Open logs', run }]);
    const withCancel = resolved({ state: 'running', cancellation: 'available', decls, handlers: { cancel: true, retry: false, has: () => true } });
    expect(withCancel.map((action) => action.id)).toEqual(['cancel', 'logs']);
    expect(withCancel[0]).toMatchObject({ kind: 'cancel', label: 'Cancel', disabled: '' });
    expect(resolved({ state: 'running', cancellation: 'unsupported', decls, handlers: { cancel: false, retry: false, has: () => true } }).map((action) => action.id)).toEqual(['logs']);
  });

  it('puts the producer\'s own first when the work is paused (Resume), then Cancel', () => {
    const decls = declared([{ id: 'resume', label: 'Resume', run }]);
    expect(resolved({ state: 'paused', cancellation: 'available', decls, handlers: { cancel: true, retry: false, has: () => true } }).map((action) => action.id)).toEqual(['resume', 'cancel']);
  });

  it('says Canceling… until the producer acknowledges, and never claims a rollback (S84)', () => {
    const asked = resolved({ state: 'running', cancellation: 'requested', handlers: { cancel: true, retry: false, has: () => false } })[0];
    expect(asked).toMatchObject({ id: 'cancel', label: 'Canceling…' });
    expect(asked?.disabled).toContain('Effects are not undone');
    const stopping = resolved({ state: 'running', cancellation: 'acknowledged', decls: declared([{ kind: 'cancel', label: 'Stop forwarding' }]), handlers: { cancel: true, retry: false, has: () => false } })[0];
    expect(stopping).toMatchObject({ label: 'Stopping…' });
    expect(stopping?.disabled).toContain('Acknowledged');
  });

  it('lets a producer relabel Cancel as Stop and disable it with its reason (S134)', () => {
    const decls = declared([{ kind: 'cancel', label: 'Stop', disabled: 'Can\'t cancel while files are replaced' }]);
    const [cancel] = resolved({ state: 'running', cancellation: 'available', decls, handlers: { cancel: true, retry: false, has: () => false } });
    expect(cancel).toMatchObject({ kind: 'cancel', label: 'Stop', disabled: 'Can\'t cancel while files are replaced' });
  });

  it('shows Cancel disabled with "Not available after restart" when its callback did not survive', () => {
    const [cancel] = resolved({ state: 'running', cancellation: 'available', handlers: { cancel: false, retry: false, has: () => false } });
    expect(cancel?.disabled).toBe('Not available after restart');
  });

  it('draws Retry first on a failure, as the primary command, then the producer\'s own', () => {
    const decls = declared([{ id: 'logs', label: 'Open logs', run }]);
    const actions = resolved({ state: 'failed', decls, handlers: { cancel: false, retry: true, has: () => true } });
    expect(actions.map((action) => [action.id, action.variant])).toEqual([['retry', 'primary'], ['logs', 'default']]);
  });

  it('has no Retry for work with no way to retry, and none for work that succeeded or still runs', () => {
    expect(resolved({ state: 'failed' }).map((action) => action.id)).toEqual([]);
    expect(resolved({ state: 'succeeded', handlers: { cancel: false, retry: true, has: () => false } }).map((action) => action.id)).toEqual([]);
    expect(resolved({ state: 'running', handlers: { cancel: false, retry: true, has: () => false } }).map((action) => action.id)).toEqual([]);
    expect(resolved({ state: 'cancelled', handlers: { cancel: false, retry: true, has: () => false } }).map((action) => action.id)).toEqual(['retry']);
  });

  it('shows Retry disabled with its reason when the callback did not survive a restart', () => {
    const decls = declared([{ kind: 'retry' }]);
    const [retry] = resolved({ state: 'failed', decls });
    expect(retry).toMatchObject({ id: 'retry', disabled: 'Not available after restart' });
  });

  it('leads an unknown outcome with the producer\'s primary recovery, then Open, Retry and the rest (S84a)', () => {
    const decls = declared([{ id: 'other', label: 'Other', run }, { id: 'check', label: 'Check status', run, primary: true }]);
    const target: Target = { label: 'api-gateway', kind: '', route: { plugin: 'cloud', contribution: 'gateways', params: {} }, removed: false };
    const actions = resolved({ state: 'unknown', decls, target, handlers: { cancel: false, retry: true, has: () => true } });
    expect(actions.map((action) => action.id)).toEqual(['check', 'open', 'retry', 'other']);
  });

  it('draws the producer\'s, then Open, then Retry for an outcome that is not a failure', () => {
    const decls = declared([{ id: 'logs', label: 'Open logs', run }]);
    const target: Target = { label: 'cart-api', kind: '', route: { plugin: 'cloud', contribution: 'instances', params: {} }, removed: false };
    const actions = resolved({ state: 'cancelled', decls, target, handlers: { cancel: false, retry: true, has: () => true } });
    expect(actions.map((action) => action.id)).toEqual(['logs', 'open', 'retry']);
  });

  it('opens the object the work produced, by its name, and never the one it deleted or the page the user is on (OF3)', () => {
    const target: Target = { label: 'Job nightly', kind: 'job', route: { plugin: 'cloud', contribution: 'jobs', params: { id: 'nightly' } }, removed: false };
    const [open] = resolved({ state: 'succeeded', target });
    expect(open).toMatchObject({ id: 'open', kind: 'open', label: 'Open Job nightly', disabled: '' });
    expect(open?.route).toEqual(target.route);
    expect(resolved({ state: 'succeeded', target: { ...target, removed: true } })).toEqual([]);
    expect(resolved({ state: 'succeeded', target, current: (candidate) => candidate === target.route })).toEqual([]);
  });

  it('keeps the label of a declared Open, and derives one from a bare "Open"', () => {
    const target: Target = { label: 'Job nightly', kind: 'job', route: undefined, removed: false };
    const named = resolved({ state: 'succeeded', target, decls: declared([{ id: 'go', route, label: 'Open logs' }]) });
    expect(named[0]?.label).toBe('Open logs');
    const bare = resolved({ state: 'succeeded', target, decls: declared([{ id: 'go', route, label: 'Open' }]) });
    expect(bare[0]?.label).toBe('Open Job nightly');
    const nameless = resolved({ state: 'succeeded', decls: declared([{ id: 'go', route }]) });
    expect(nameless[0]?.label).toBe('Open details');
  });

  it('is primary only for the first action, and only a Retry or one that says so', () => {
    const decls = declared([{ id: 'fix', label: 'Fix', run, primary: true }, { id: 'also', label: 'Also', run, primary: true }]);
    expect(resolved({ state: 'succeeded', decls }).map((action) => action.variant)).toEqual(['primary', 'default']);
    expect(resolved({ state: 'succeeded', decls: declared([{ id: 'fix', label: 'Fix', run }]) })[0]?.variant).toBe('default');
  });

  it('carries the glyph a producer declared and the danger tint, and no glyph of its own', () => {
    const [action] = resolved({ state: 'succeeded', decls: declared([{ id: 'x', label: 'X', run, icon: 'trash', danger: true }]) });
    expect(action).toMatchObject({ icon: 'trash', danger: true });
    expect(resolved({ state: 'succeeded', decls: declared([{ id: 'y', label: 'Y', run }]) })[0]?.icon).toBe('');
  });

  it('shows a command whose code did not survive a restart as disabled, with the reason (S84)', () => {
    const decls = declared([{ id: 'fix', label: 'Fix', run }, { id: 'go', label: 'Go', route }]);
    const actions = resolved({ state: 'succeeded', decls, handlers: { cancel: false, retry: false, has: () => false } });
    expect(actions.map((action) => [action.id, action.disabled])).toEqual([['fix', 'Not available after restart'], ['go', '']]);
  });

  it('says why when the plugin that owns the code left: the button stays and does nothing', () => {
    const decls = declared([{ id: 'fix', label: 'Fix', run }, { id: 'go', label: 'Go', route }]);
    const actions = resolved({ state: 'succeeded', decls, dead: 'Cloud isn\'t running.', handlers: { cancel: false, retry: true, has: () => true } });
    expect(actions.map((action) => [action.id, action.disabled])).toEqual([['fix', 'Cloud isn\'t running.'], ['go', '']]);
  });

  it('asks the host whether a route or a command can be used, and disables what it refuses with its reason; a degraded one still opens (S65)', () => {
    const decls = declared([{ id: 'go', label: 'Go', route }, { id: 'cmd', label: 'Cmd', command: { id: 'host.do' } }, { id: 'deg', label: 'Deg', route: { plugin: 'cloud', contribution: 'volumes' } }]);
    const actions = resolved({
      state: 'succeeded',
      decls,
      availability: (asked) => (asked.contribution === 'instances' ? { state: 'unavailable', reason: 'Cloud is turned off' } : asked.contribution === 'volumes' ? { state: 'degraded' } : { state: 'available' }),
      commandAvailability: () => ({ state: 'unavailable', reason: 'No connection' }),
    });
    expect(Object.fromEntries(actions.map((action) => [action.id, action.disabled]))).toEqual({ go: 'Cloud is turned off', cmd: 'No connection', deg: '' });
  });

  it('lets a declared reason win over every other', () => {
    const decls = declared([{ id: 'fix', label: 'Fix', run, disabled: 'Wait for the other one' }]);
    expect(resolved({ state: 'succeeded', decls, dead: 'Cloud isn\'t running.' })[0]?.disabled).toBe('Wait for the other one');
  });

  it('keeps the action the model provides itself (Mute) usable when its plugin left', () => {
    const decls = [{ id: 'mute', kind: 'custom' as const, label: 'Mute for 1 hour', route: undefined, reveal: undefined, command: undefined, code: false, primary: false, danger: false, icon: '', disabled: '', builtin: 'mute' as const }];
    expect(resolved({ state: 'succeeded', decls, dead: 'Cloud isn\'t running.' })[0]?.disabled).toBe('');
  });

  it('hands a view data and nothing it could call', () => {
    const decls = declared([{ id: 'go', label: 'Go', route }, { id: 'cmd', label: 'Cmd', command: { id: 'host.do', arg: 1 } }]);
    const actions = resolved({ state: 'succeeded', decls });
    expect(JSON.parse(JSON.stringify(actions))).toBeTruthy();
    expect(actions.every((action) => Object.isFrozen(action))).toBe(true);
  });
});
