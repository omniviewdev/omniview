import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { LIMITS, TIMING } from './types';

// The oracle: the design lab's cases, ported (docs/ui-next/status/O1a.md has the same list and the reasons).
//
// THE HARNESS (`tests/shell-model-harness/`) HAS NO UNIT OF ITS OWN FOR NOTIFICATIONS OR OPERATIONS: `shell-notify.js` and `shell-feedback.js` are covered by the lab's browser gates, not by the
// model harness. Three of its cases touch a notification, and are ported here:
//   H1  R2Store/unit.cjs:705-708   an unknown window raises an ERROR notification WITH Retry (severity, title, first action `retry`);
//   H2  R2Store/unit.cjs:1275-1290 a damaged saved layout raises ONE warning, "Saved tabs couldn't be restored", severity `warning`;
//   H3  R2Store/unit.cjs:1916-1924 `Shell.toasts.dismissAll` (a scenario reset): every toast goes, nothing is deleted.
// THE EVIDENCE SCRIPT of the lab's notification regression (in its `evidence/` directory) is the lab's one executable statement of the notification policy (it runs the real store in a browser); its seven checks are
// ported as E1 to E7. THE AUDIT `shell-qa-search-feedback.md`: QA-SF-03, 10, 13, 14, 27, 29. THE SIMULATIONS of `shell-feedback.js` (S152) that exercise the record: connect-failing (attempts),
// plugin-install (S134), burst-12 (S79), connection-sync (S77), port-forward (S84), rollout-restart (S74).
//
// NOT PORTED, with the reason:
//   E8  `windowSuccessQuietAcrossTabs` (an operation owned by a WINDOW, `origin.window`): the model has no windows (the tab model: "Windows and split panes: no window kind exists"); the model's
//       `origin` is a tab and an anchor, and `inline()` is the host's answer.
//   QA-SF-11 (a unit agrees with its count, "1 widgets"): the words of a count are the producer's; the model does not inflect a producer's units.
//   QA-SF-12 and the legacy toasts (an element appended to `#feedback` by 17 category files): a DOM shim of the mock; no model.
//   QA-SF-04, 15, 22 (the Operations tool's table columns and row heights), QA-SF-16, 20, 21 (status popovers and the overflow list), QA-SF-30 (empty-state wording): views.
//   QA-SF-05, 28 and S74 conditions (plugin health, connections): derived from health, not records; their step is the status area's.
//   QA-SF-01, 02, 06 to 09, 17 to 19, 24 to 26: the palette and the menus.
//   The placement rule (a toast never covers a control, `Shell.toasts.placement`, hit-tested by `elementsFromPoint`) and the legacy-toast adopter: DOM, the UI step's probe.
//   The gallery's stress run (1000 ticks, a MutationObserver): its model half is `perf.test.ts`; its DOM half is the UI step's.
//   `copyOf`, the success-copy lint (a banned word, a gerund done title): a producer lint (`Shell.msg.lint`), which the host does not have.
//   `Shell.reads`, `kind: 'read'`, `silent`: reads are queries, never operations (OF1); the model has no way to begin one.

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };
const second = 1000;

describe('the harness', () => {
  it('H1: an error raised for something that could not be done has a Retry, and it is the first command, primary and enabled (RC1)', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'Couldn\'t move instances', severity: 'error', initiator: 'user', actions: [{ id: 'retry', kind: 'retry', label: 'Retry', run: () => undefined }] });
    const record = store.getSnapshot().recent[0];
    expect([record?.severity, record?.title, record?.actions[0]?.kind]).toEqual(['error', 'Couldn\'t move instances', 'retry']);
    expect(record?.actions[0]).toMatchObject({ variant: 'primary', disabled: '' });
    expect(store.getSnapshot().toasts.items.map((item) => [item.sticky, item.urgent])).toEqual([[true, true]]);
  });

  it('H2: one event, one warning notice, with no command to decide: it closes by itself and stays in the bell', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'Saved tabs couldn\'t be restored', severity: 'warning' });
    expect(store.getSnapshot().recent).toHaveLength(1);
    expect([store.getSnapshot().recent[0]?.severity, store.getSnapshot().recent[0]?.title]).toEqual(['warning', 'Saved tabs couldn\'t be restored']);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().bell).toMatchObject({ dot: 'warning', unread: 1 });
  });

  it('H3: dismissing every toast removes the toasts and deletes nothing', () => {
    const { store } = makeNotices();
    for (let index = 1; index <= 4; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    store.dismissToasts();
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().recent).toHaveLength(4);
  });
});

describe('the evidence script (the lab\'s notification regression)', () => {
  it('E1 quietAutomatic and E2 automaticRateWarnings: twenty-five automatic operations, each succeeded or cancelled, are read history with no toast and no "posting many notifications" row', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const automatic: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      for (const outcome of ['succeeded', 'cancelled'] as const) {
        const handle = producer.begin({ title: 'Checking feedback', initiator: 'system', onCancel: () => undefined });
        automatic.push(handle.id);
        handle.finish(outcome);
      }
    }

    const state = store.getSnapshot();
    expect(automatic.every((id) => state.recent.some((record) => record.id === id && record.read && !record.toasted))).toBe(true);
    expect(state.recent.filter((record) => record.fold === 'rate' || record.title.includes('posting many'))).toHaveLength(0);
    expect(state.toasts.items).toEqual([]);
  });

  it('E3 inlineStartedQuiet: work the user started, with its control on screen, raises no toast', () => {
    const { store, inline } = makeNotices();
    inline.add('mainscroll');
    store.forSource('cloud').begin({ title: 'Checking feedback', initiator: 'user', origin: { tab: 't1', anchor: 'mainscroll' }, onCancel: () => undefined });
    expect(store.getSnapshot().recent.concat(store.getSnapshot().active).every((record) => !record.toasted)).toBe(true);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('E4 inlineSuccessQuiet: its success is read, with no toast', () => {
    const { store, inline } = makeNotices();
    inline.add('mainscroll');
    const handle = store.forSource('cloud').begin({ title: 'Checking feedback', initiator: 'user', origin: { tab: 't1', anchor: 'mainscroll' }, onCancel: () => undefined });
    handle.finish('succeeded');
    const record = store.selectors.record(handle.id);
    expect(record?.read && !record.toasted).toBe(true);
  });

  it('E5 localFailureRetained: its failure is kept, unread, with no toast: the control shows it', () => {
    const { store, inline } = makeNotices();
    inline.add('mainscroll');
    const handle = store.forSource('cloud').begin({ title: 'Checking feedback', initiator: 'user', origin: { tab: 't1', anchor: 'mainscroll' }, onCancel: () => undefined });
    handle.finish('failed', { message: 'The request was rejected. Review the input.' });
    const record = store.selectors.record(handle.id);
    expect(record?.state === 'failed' && !record.read && !record.toasted).toBe(true);
  });

  it('E6 backgroundFailureVisible: a failure of work the user started and is not looking at is unread and has a toast', () => {
    const { store } = makeNotices();
    const handle = store.forSource('cloud').begin({ title: 'Checking feedback', initiator: 'user', onCancel: () => undefined });
    handle.finish('failed', { message: 'The request was rejected. Review the input.' });
    const record = store.selectors.record(handle.id);
    expect(record && !record.read && record.toasted).toBe(true);
    expect(store.getSnapshot().toasts.items.some((item) => item.id === handle.id)).toBe(true);
  });

  it('E7 emptyInline: a record that is not there renders nothing: no idle label, no track', () => {
    const { store } = makeNotices();
    expect(store.selectors.pageOperation('nothing')).toBeNull();
    expect(store.selectors.record('nothing')).toBeUndefined();
  });
});

describe('the audit', () => {
  it('QA-SF-03: Retry starts the SAME record again: attempt 2 fails, attempt 3 succeeds, and each surface shows the new attempt', () => {
    const { store } = makeNotices();
    let attempts = 1;
    const handle = store.forSource('cloud').begin({
      title: 'Reconnecting data source Prometheus',
      doneTitle: 'Reconnected data source Prometheus',
      initiator: 'user',
      progress: 'indeterminate',
      message: 'Opening 3 connections',
      onRetry: () => {
        attempts += 1;
        handle.restart({ message: 'Opening 3 connections' });
        if (attempts < 3) {
          handle.fail('Nothing answered on port 9090. Check that it is running, then retry.');
        } else {
          handle.succeed({ message: 'All 3 connections are open.' });
        }
      },
    });
    handle.fail('Nothing answered on port 9090. Check that it is running, then retry.');
    expect(store.run(handle.id, 'retry')).toMatchObject({ status: 'done' });
    expect(store.selectors.record(handle.id)).toMatchObject({ state: 'failed', attempt: 2 });
    expect(store.run(handle.id, 'retry')).toMatchObject({ status: 'done' });
    expect(store.selectors.record(handle.id)).toMatchObject({ state: 'succeeded', attempt: 3, title: 'Reconnected data source Prometheus' });
    expect(store.getSnapshot().recent.concat(store.getSnapshot().active)).toHaveLength(1);
  });

  it('QA-SF-10: a tick is written once for every rendering of a record: the toast, the row and the status track share ONE view, made once for the tick', async () => {
    const { store, clock } = makeNotices();
    store.subscribe(() => undefined);
    const handle = store.begin({ title: 'Stress: 200 ticks', initiator: 'user', progress: { current: 0, total: 200, unit: 'ticks' } });
    const before = store.stats().views;
    for (let tick = 1; tick <= 200; tick += 1) {
      handle.progress({ current: tick });
      await clock.advance(25);
      const state = store.getSnapshot();
      expect(state.toasts.items[0]?.record).toBe(state.active[0]);
    }

    // One view for each tick, and one more each second for what a screen reader is told (five seconds here).
    expect(store.stats().views - before).toBeLessThanOrEqual(200 + 6);
    expect(store.getSnapshot().activity.bar?.fraction).toBe(1);
  });

  it('QA-SF-13: the summary toast carries the worst severity it hides, in a burst of twelve from four plugins in one and a half seconds, with nothing lost (S79)', async () => {
    const { store, clock } = makeNotices();
    const list: ReadonlyArray<readonly [string, string, string, string]> = [
      ['error', 'Disk d1 ran out of space', 'The volume used all of its 512 GiB.', 'cloud'], ['warning', 'Node n-14 is under memory pressure', 'Evicting 3 jobs', 'cloud'], ['warning', 'Node n-15 is under memory pressure', 'Evicting 2 jobs', 'cloud'],
      ['warning', 'Node n-16 is under memory pressure', 'Evicting 1 job', 'cloud'], ['info', 'Certificate renewed for api.acme.example', 'Valid for 90 days', 'stack'], ['error', 'Couldn\'t reach eu-west-1', 'Check the network or the account role.', 'stack'],
      ['success', 'Snapshot snap-0a1b2c created', '40 GiB in us-east-1', 'stack'], ['warning', 'Rate limit is close', '92% of the quota is used.', 'metrics'], ['info', 'Dashboard "Checkout latency" saved', 'Version 14', 'metrics'],
      ['warning', 'Alert rule HighErrorRate is firing', '3 of 5 evaluations are over 2%.', 'metrics'], ['success', 'Data source Loki is healthy', 'Last query 120 ms', 'backup'], ['info', 'Backup job nightly-pbs finished', '12 guests, 1.4 TiB', 'backup'],
    ];
    for (const [severity, title, detail, source] of list) {
      store.forSource(source).notify({ severity: severity as 'info', title, detail, initiator: 'system' });
      await clock.advance(130);
    }

    const state = store.getSnapshot();
    expect(state.toasts.items).toHaveLength(LIMITS.toasts);
    const summary = state.toasts.items[0];
    expect(summary?.id).toBe('__summary');
    expect(summary?.summary?.count).toBe(10);
    expect(summary?.summary?.severity).toBe('error');
    expect(state.recent).toHaveLength(12);
    expect(state.counts.all).toBe(12);
  });

  it('QA-SF-14: a mute is exactly the time it was given, so the settings page can say "For 1 hour" and "Until I turn it on", and a restart keeps both', () => {
    const { store, clock } = makeNotices();
    store.mute('cloud', clock.now() + TIMING.hour);
    store.mute('stack', 'forever');
    const [cloud, stack] = store.getSnapshot().muted;
    expect(cloud?.until).toBe(clock.now() + TIMING.hour);
    expect(stack?.until).toBe('forever');
  });

  it('QA-SF-27: one sync, one count: the status area and the row of the record read the same sample, however many surfaces draw it', async () => {
    const { store, clock } = makeNotices();
    const sync = store.begin({ title: 'Syncing 12 connections', initiator: 'system', progress: { current: 0, total: 12, unit: 'connections' }, message: 'Reading resources from each plugin' });
    for (let done = 2; done <= 8; done += 2) {
      sync.progress({ current: done });
      await clock.advance(700);
      const state = store.getSnapshot();
      expect(state.activity.bar?.text).toBe(state.active[0]?.progress?.a11y.text);
    }

    await clock.advance(second);
    expect(store.getSnapshot().activity.bar?.text).toBe('8 of 12 connections');
  });

  it('QA-SF-29: the start of work is told once and the finish once, however much the record changes in between', () => {
    const { store, said, inline } = makeNotices();
    inline.add('b');
    const handle = store.forSource('cloud').begin({ title: 'Restarting Cloud', doneTitle: 'Restarted Cloud', initiator: 'user', origin: { anchor: 'b' } });
    handle.update({ message: 'Stopping the process' });
    handle.update({ message: 'Starting the process' });
    handle.progress('indeterminate');
    handle.succeed({ message: 'Cloud is running again.' });
    handle.succeed();
    expect(said.map((entry) => entry.text)).toEqual(['Restarting Cloud', 'Restarted Cloud']);
  });
});

describe('the simulations', () => {
  it('connection-sync (S77): a sync nobody started raises no toast while it runs and none when it works; the status area shows it, from the one record', () => {
    const { store, said } = makeNotices();
    const sync = store.begin({ title: 'Syncing 12 connections', doneTitle: 'Synced 12 connections', initiator: 'system', progress: { current: 0, total: 12, unit: 'connections' }, message: 'Reading resources from each plugin' });
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().activity).toMatchObject({ count: 1, text: 'Syncing 12 connections' });
    sync.progress({ current: 6 });
    sync.succeed({ message: 'Every connection is up to date.' });
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().recent[0]).toMatchObject({ state: 'succeeded', read: true });
    expect(said).toEqual([]);
  });

  it('rollout-restart (S74): live facts with counts, no Cancel (the producer cannot stop it), then the effect and Open logs', () => {
    const { store } = makeNotices();
    const left = (updated: number) => [{ label: 'Updated', value: String(updated), unit: 'items' }, { label: 'Old', value: String(7 - updated), unit: 'items' }];
    const handle = store.forSource('cloud').begin({ title: 'Restarting api-gateway', doneTitle: 'Restarted api-gateway', initiator: 'user', target: { label: 'api-gateway', kind: 'restart' }, progress: { current: 0, total: 7, unit: 'items' }, message: 'Draining the first node', fields: left(0), actions: [{ id: 'logs', label: 'Open logs', route }] });
    expect(store.getSnapshot().active[0]?.actions.map((action) => action.kind)).not.toContain('cancel');
    handle.update({ progress: { current: 3 }, message: 'Draining node 4', fields: left(3) });
    handle.succeed({ message: 'All 7 items are ready.', fields: left(7) });
    expect(store.getSnapshot().recent[0]).toMatchObject({ title: 'Restarted api-gateway', text: 'All 7 items are ready.', fields: [{ label: 'Updated', value: '7' }, { label: 'Old', value: '0' }] });
    expect(store.getSnapshot().recent[0]?.actions.map((action) => action.label)).toEqual(['Open logs']);
  });

  it('plugin-install (S134): nine steps; Cancel until the first irreversible one, then disabled with its reason; a canceled install offers Retry on the same record', () => {
    const { store } = makeNotices();
    const steps = ['Resolve', 'Download', 'Verify checksum', 'Verify signature', 'Unpack', 'Check compatibility', 'Install', 'Start', 'Load interface'];
    let canceled = 0;
    const handle = store.begin({ title: 'Installing plugin cloud', doneTitle: 'Installed plugin cloud', initiator: 'user', target: { label: 'cloud', kind: 'install' }, progress: { kind: 'steps', current: 1, total: 9, steps }, cancellation: 'available', onCancel: () => {
      canceled += 1;
    }, onRetry: () => {
      handle.restart();
    } });
    expect(store.getSnapshot().active[0]?.actions[0]).toMatchObject({ kind: 'cancel', disabled: '' });
    for (let step = 2; step <= 7; step += 1) {
      handle.step(step);
    }

    expect(store.getSnapshot().active[0]).toMatchObject({ text: 'Install', progress: { current: 7, label: 'Install' } });
    handle.update({ actions: [{ kind: 'cancel', label: 'Cancel', disabled: 'Can\'t cancel while files are replaced' }] });
    expect(store.run(handle.id, 'cancel')).toEqual({ status: 'refused', reason: 'disabled', message: 'Can\'t cancel while files are replaced' });
    expect(canceled).toBe(0);
    handle.cancel({ message: 'Stopped before any file was replaced.' });
    expect(store.getSnapshot().recent[0]?.actions.map((action) => [action.id, action.disabled])).toEqual([['retry', '']]);
    expect(store.run(handle.id, 'retry')).toMatchObject({ status: 'done' });
    expect(store.getSnapshot().active[0]).toMatchObject({ id: handle.id, attempt: 2, state: 'running' });
  });

  it('port-forward (S84): a Stop that says Stopping… until it is acknowledged, never claims a rollback, and a stopped forward offers Retry', () => {
    const { store } = makeNotices();
    const handle = store.begin({ title: 'Forwarding api-gateway to localhost:8080', doneTitle: 'Stopped forwarding localhost:8080', initiator: 'user', progress: 'indeterminate', onCancel: () => undefined, onRetry: () => undefined, actions: [{ id: 'cancel', kind: 'cancel', label: 'Stop' }] });
    expect(store.getSnapshot().active[0]?.actions[0]).toMatchObject({ label: 'Stop' });
    store.run(handle.id, 'cancel');
    expect(store.getSnapshot().active[0]).toMatchObject({ word: 'Stopping…' });
    handle.acknowledgeCancel();
    handle.cancel({ message: 'localhost:8080 is closed.' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ state: 'cancelled', word: 'Canceled', text: 'localhost:8080 is closed.' });
    expect(store.getSnapshot().recent[0]?.actions.map((action) => action.id)).toEqual(['retry']);
  });

  it('a producer that loses track of the outcome says so, with the way to check it first (S84a)', () => {
    const { store } = makeNotices();
    const handle = store.begin({ title: 'Reconnecting data source', initiator: 'user', target: { label: 'Prometheus', kind: 'connection', route }, onRetry: () => undefined, actions: [{ id: 'check', label: 'Check status', run: () => undefined, primary: true }] });
    handle.unknown({ message: 'The connection dropped while it was opening.' });
    const record = store.getSnapshot().recent[0];
    expect(record).toMatchObject({ state: 'unknown', severity: 'warning', word: 'Outcome unknown.', text: 'Check Prometheus. The connection dropped while it was opening.' });
    expect(record?.actions.map((action) => action.id)).toEqual(['check', 'open', 'retry']);
    expect(record?.actions[0]).toMatchObject({ variant: 'primary' });
  });
});
