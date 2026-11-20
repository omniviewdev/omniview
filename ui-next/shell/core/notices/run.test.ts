import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';

// Running an action (ch16 S64, S74, S81, S84; ch05 RC1; the mock's `run`, `requestCancel`, `openTarget`, `failedAction`, shell-notify.js:462-537): a route opens through the tab model with the
// disposition of the modifiers; a command runs through the registry with plain arguments; the producer's own code runs with what it needs to know. Acting on a record marks it read. What
// throws, rejects or refuses is contained: it is told to the host's hook, and the person is told, in words, that the action did not run; it never breaks the model or another plugin.

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };
const timeout = { type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'The cluster did not complete the request in time.', code: 'TIMEOUT' };

describe('a route action', () => {
  it('opens through the tab model with the notification as its source, and the page is asked to reveal what the producer named', () => {
    const { store, opened } = makeNotices();
    store.forSource('cloud').notify({ title: 'Instance stopped', actions: [{ id: 'go', label: 'Open instance', route, reveal: { tab: 'logs' } }] });
    expect(store.run('n1', 'go')).toEqual({ status: 'done', opened: { status: 'done', id: 't1', change: 'created', focused: true } });
    expect(opened).toEqual([{ destination: { route, reveal: { tab: 'logs' } }, options: { how: 'smart', source: 'notification' } }]);
  });

  it('takes the disposition from the modifiers (S64), or a disposition by name', () => {
    const { store, opened } = makeNotices();
    store.notify({ title: 'Instance stopped', actions: [{ id: 'go', route }] });
    store.run('n1', 'go', { shiftKey: true });
    store.run('n1', 'go', { ctrlKey: true });
    store.run('n1', 'go', { altKey: true });
    store.run('n1', 'go', 'new');
    expect(opened.map((entry) => entry.options.how)).toEqual(['window', 'background', 'here', 'new']);
  });

  it('uses Command, not Control, on macOS', () => {
    const { store, opened } = makeNotices({ platform: 'mac' });
    store.notify({ title: 'Instance stopped', actions: [{ id: 'go', route }] });
    store.run('n1', 'go', { metaKey: true });
    store.run('n1', 'go', { ctrlKey: true });
    expect(opened.map((entry) => entry.options.how)).toEqual(['background', 'smart']);
  });

  it('marks the record read: the user acted on it (S81), and its toast goes', () => {
    const { store } = makeNotices();
    store.notify({ title: 'Instance stopped', actions: [{ id: 'go', route }] });
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    store.run('n1', 'go');
    expect(store.getSnapshot().recent[0]).toMatchObject({ read: true, unread: false });
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('opens the object the work produced, from the Open that the record offers', () => {
    const { store, opened } = makeNotices();
    const op = store.begin({ title: 'Running now', doneTitle: 'Started Job nightly', initiator: 'user', target: { label: 'Job nightly', kind: 'job', route } });
    op.succeed();
    expect(store.run(op.id, 'open')).toMatchObject({ status: 'done' });
    expect(opened[0]?.destination.route).toEqual(route);
  });

  it('is refused, with the reason, when it cannot be opened: the plugin is off (S65)', () => {
    const { store, opened, off } = makeNotices();
    store.notify({ title: 'Instance stopped', actions: [{ id: 'go', route }] });
    off.add('cloud');
    store.refresh();
    expect(store.getSnapshot().recent[0]?.actions[0]).toMatchObject({ id: 'go', disabled: 'cloud is turned off' });
    expect(store.run('n1', 'go')).toEqual({ status: 'refused', reason: 'disabled', message: 'cloud is turned off' });
    expect(opened).toEqual([]);
    expect(store.getSnapshot().recent[0]?.read).toBe(false);
  });

  it('is left out of the record that would open the page the user is on (OF3)', () => {
    const { store, on } = makeNotices();
    on.route = { plugin: 'cloud', contribution: 'jobs', params: { id: 'nightly' } };
    const op = store.begin({ title: 'Running now', initiator: 'user', target: { label: 'Job nightly', kind: 'job', route: { plugin: 'cloud', contribution: 'jobs', params: { id: 'nightly' } } } });
    op.succeed();
    expect(store.getSnapshot().recent[0]?.actions).toEqual([]);
    on.route = undefined;
    store.refresh();
    expect(store.getSnapshot().recent[0]?.actions.map((action) => action.id)).toEqual(['open']);
  });

  it('is refused when the host gave the model nothing to open with: a button the host cannot act on is disabled by the host\'s answer, never left dead', () => {
    const { store } = makeNotices({ open: undefined });
    store.notify({ title: 'Instance stopped', actions: [{ id: 'go', route }] });
    expect(store.run('n1', 'go')).toMatchObject({ status: 'refused', reason: 'unavailable' });
  });
});

describe('a command action', () => {
  it('runs through the registry with the plain arguments it was given', () => {
    const { store, commands } = makeNotices();
    store.notify({ title: 'Sign in again', severity: 'warning', actions: [{ id: 'sign', label: 'Sign in', command: { id: 'host.signIn', arg: { account: 'prod' }, target: { tab: 't1' } } }] });
    expect(store.run('n1', 'sign')).toEqual({ status: 'done' });
    expect(commands).toEqual([{ id: 'host.signIn', arg: { account: 'prod' }, target: { tab: 't1' } }]);
    expect(store.getSnapshot().recent[0]?.read).toBe(true);
  });

  it('is disabled with the reason the registry gives', () => {
    const { store, commands, off } = makeNotices();
    store.notify({ title: 'Sign in again', actions: [{ id: 'sign', label: 'Sign in', command: { id: 'cloud.signIn' } }] });
    off.add('cloud');
    store.refresh();
    expect(store.run('n1', 'sign')).toEqual({ status: 'refused', reason: 'disabled', message: 'The command is turned off' });
    expect(commands).toEqual([]);
  });

  it('is refused when the host has no registry to run it', () => {
    const { store } = makeNotices({ run: undefined });
    store.notify({ title: 'Sign in again', actions: [{ id: 'sign', label: 'Sign in', command: { id: 'host.signIn' } }] });
    expect(store.run('n1', 'sign')).toMatchObject({ status: 'refused', reason: 'unavailable' });
  });
});

describe('the producer\'s own code', () => {
  it('runs with the record, the action and the event, and marks the record read', () => {
    const { store } = makeNotices();
    const calls: unknown[] = [];
    store.notify({ title: 'Disk is almost full', severity: 'warning', actions: [{ id: 'clean', label: 'Clean up', run: (call) => calls.push(call) }] });
    expect(store.run('n1', 'clean')).toEqual({ status: 'done' });
    expect(store.run('n1', 'clean', { shiftKey: true })).toEqual({ status: 'done' });
    expect(calls).toEqual([{ id: 'n1', action: 'clean', event: undefined }, { id: 'n1', action: 'clean', event: { shiftKey: true } }]);
    expect(store.getSnapshot().recent[0]?.read).toBe(true);
  });

  it('is refused for a record that is gone, an action that is not there and a command that is disabled, each in its own words', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A', actions: [{ id: 'x', label: 'X', run: () => undefined, disabled: 'Wait for the other one' }] });
    expect(store.run('gone', 'x')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(store.run('n1', 'nope')).toMatchObject({ status: 'refused', reason: 'none' });
    expect(store.run('n1', 'x')).toEqual({ status: 'refused', reason: 'disabled', message: 'Wait for the other one' });
  });
});

describe('what fails is contained (a throwing action, a rejecting one, a seam that throws)', () => {
  it('tells the host\'s hook, tells the person in words, and refuses: nothing else is affected', () => {
    const { store, errors } = makeNotices();
    store.forSource('cloud').notify({ title: 'Disk is almost full', severity: 'warning', actions: [{ id: 'fix', label: 'Fix it', run: () => {
      throw new Error('secret token abc123');
    } }] });
    const result = store.run('n1', 'fix');
    expect(result).toMatchObject({ status: 'refused', reason: 'failed' });
    expect(errors.some((entry) => entry.where.includes('action'))).toBe(true);
    const failure = store.getSnapshot().recent[0];
    expect(failure).toMatchObject({ kind: 'message', severity: 'error', title: 'Couldn\'t fix it', text: 'The operation could not be completed.', source: 'cloud', initiator: 'user' });
    expect(failure?.details).toContain('abc123');
    expect(failure?.text).not.toContain('abc123');
    expect(store.getSnapshot().recent).toHaveLength(2);
  });

  it('is of the plugin whose action failed, so a plugin whose action keeps throwing cannot flood: the rate holds for it too', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'A', actions: [{ id: 'fix', label: 'Fix', run: () => {
      throw new Error('no');
    } }] });
    for (let index = 0; index < 30; index += 1) {
      store.run('n1', 'fix');
    }

    const { recent } = store.getSnapshot();
    expect(recent.length).toBeLessThan(10);
    expect(recent.every((record) => record.source === 'cloud')).toBe(true);
  });

  it('turns a promise that rejects with the host\'s error into its notice, in the caller\'s own title', async () => {
    const { store, clock } = makeNotices();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the host rejects with its parsed envelope, a plain object, and that is what is under test
    store.forSource('cloud').notify({ title: 'Cart is slow', severity: 'warning', actions: [{ id: 'scale', label: 'Scale it', run: async () => Promise.reject(timeout) }] });
    expect(store.run('n1', 'scale')).toEqual({ status: 'done' });
    await clock.flush();
    expect(store.getSnapshot().recent[0]).toMatchObject({ severity: 'error', title: 'Couldn\'t scale it', text: 'The cluster did not complete the request in time.', source: 'cloud' });
  });

  it('says nothing when the promise rejects because the work was cancelled', async () => {
    const { store, clock } = makeNotices();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the host rejects with its parsed envelope, a plain object, and that is what is under test
    store.notify({ title: 'Cart is slow', actions: [{ id: 'scale', label: 'Scale it', run: async () => Promise.reject({ type: 'omniview:cancelled', title: 'Cancelled', status: 499, detail: 'The operation was cancelled.', code: 'CANCELLED' }) }] });
    store.run('n1', 'scale');
    await clock.flush();
    expect(store.getSnapshot().recent).toHaveLength(1);
  });

  it('contains a tab model that throws when it is asked to open, and a registry that throws or rejects', async () => {
    const { store, clock, errors } = makeNotices({
      open: () => {
        throw new Error('no tab');
      },
      run: async () => Promise.reject(new Error('no command')),
    });
    store.notify({ title: 'A', actions: [{ id: 'go', label: 'Go', route }, { id: 'cmd', label: 'Cmd', command: { id: 'host.do' } }] });
    expect(store.run('n1', 'go')).toMatchObject({ status: 'refused', reason: 'failed' });
    store.run('n1', 'cmd');
    await clock.flush();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(store.getSnapshot().recent.filter((record) => record.severity === 'error')).not.toHaveLength(0);
  });

  it('contains a host that throws where it is asked a question: the model goes on with what costs the person least', () => {
    const { store, errors } = makeNotices({
      availability: () => {
        throw new Error('broken');
      },
      announce: () => {
        throw new Error('broken');
      },
      inline: () => {
        throw new Error('broken');
      },
      pluginName: () => {
        throw new Error('broken');
      },
      current: () => {
        throw new Error('broken');
      },
    });
    const op = store.begin({ title: 'Working', initiator: 'user', origin: { anchor: 'x' }, target: { label: 't', route } });
    op.succeed();
    store.notify({ title: 'A', actions: [{ id: 'go', route }] });
    expect(store.getSnapshot().recent).toHaveLength(2);
    expect(store.getSnapshot().recent[0]?.actions[0]?.disabled).toBe('');
    expect(errors.length).toBeGreaterThan(0);
  });
});
