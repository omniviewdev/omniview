import type { PageOperation } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';

// The page header's operation slot (ch05 OF2, ch12 PH2; the kit's `PageOperation`, packages/kit/src/components/PageHeader/operation.ts): the inline rendering of ONE record, drawn where the work
// began. The model feeds it a record with nothing wired behind it but three callbacks; the presenter's own clock calls `onDismiss` eight seconds after a calm outcome, and the model keeps the
// flag, so the slot goes back to rest and the history keeps the record. A null record renders nothing: no idle label, no track (S76a).

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };

/** The model's value is, structurally, what the kit's slot takes: this does not compile when it is not. */
const forKit = (value: PageOperation): PageOperation => value;

describe('what the slot is fed', () => {
  it('is nothing for what is not an operation that is on screen: a message, a record that is gone, an id that was never one', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A' });
    expect(store.selectors.pageOperation('n1')).toBeNull();
    expect(store.selectors.pageOperation('gone')).toBeNull();
    expect(store.selectors.pageOperation('')).toBeNull();
  });

  it('is the record of work that runs: its name, its state, the one sentence, how far it is, and Cancel', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', initiator: 'user', progress: { current: 2, total: 5, unit: 'replicas' }, message: 'Scaling orders-api: 2 of 5 replicas', onCancel: () => undefined });
    const slot = store.selectors.pageOperation(op.id);
    expect(slot).toMatchObject({ title: 'Scaling orders-api', state: 'running', text: 'Scaling orders-api: 2 of 5 replicas', progress: 0.4 });
    expect(slot?.actions?.map((action) => [action.id, action.label, action.kind, action.disabledReason])).toEqual([['cancel', 'Cancel', 'cancel', undefined]]);
    expect(typeof slot?.onDismiss).toBe('function');
    if (slot !== null) {
      forKit(slot);
    }
  });

  it('says a bar that cannot be measured as indeterminate, a step as the steps behind it, and no bar for work with no measure', () => {
    const { store } = makeNotices();
    const indeterminate = store.begin({ title: 'A', progress: 'indeterminate' });
    const steps = store.begin({ title: 'B', progress: { kind: 'steps', current: 3, total: 4, steps: ['a', 'b', 'c', 'd'] } });
    const none = store.begin({ title: 'C' });
    expect(store.selectors.pageOperation(indeterminate.id)?.progress).toBe('indeterminate');
    expect(store.selectors.pageOperation(steps.id)?.progress).toBe(0.5);
    expect(store.selectors.pageOperation(none.id)?.progress).toBeUndefined();
  });

  it('is the sentence of the outcome once it ended, with the record\'s first command, and no bar', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user', progress: { current: 2, total: 5 }, target: { label: 'orders-api', kind: 'deployment', route } });
    op.succeed({ message: '5 replicas are ready' });
    const slot = store.selectors.pageOperation(op.id);
    expect(slot).toMatchObject({ state: 'succeeded', text: 'Scaled orders-api. 5 replicas are ready', progress: undefined });
    expect(slot?.actions?.map((action) => [action.label, action.kind])).toEqual([['Open orders-api', 'custom']]);
  });

  it('is a failure with its cause and Retry as the first command, which Retry then runs', () => {
    const { store } = makeNotices();
    let retried = 0;
    const op = store.begin({ title: 'Scaling orders-api', initiator: 'user', onRetry: () => {
      retried += 1;
    } });
    op.fail('The cluster did not answer.');
    const slot = store.selectors.pageOperation(op.id);
    expect(slot).toMatchObject({ state: 'failed', text: 'Couldn\'t scale orders-api. The cluster did not answer.' });
    expect(slot?.actions?.[0]).toMatchObject({ id: 'retry', label: 'Retry', kind: 'retry' });
    slot?.actions?.[0]?.onSelect();
    expect(retried).toBe(1);
  });

  it('says why a command cannot be used, and its button does nothing: the slot never draws a dead button', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user', actions: [{ kind: 'retry' }] });
    op.fail();
    const retry = store.selectors.pageOperation(op.id)?.actions?.[0];
    expect(retry?.disabledReason).toBe('Not available after restart');
    expect(() => retry?.onSelect()).not.toThrow();
  });

  it('runs a command of the record through the one place that runs them: acting marks it read', () => {
    const { store, commands } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user', actions: [{ id: 'sign', label: 'Sign in', command: { id: 'host.signIn' } }] });
    op.succeed();
    store.selectors.pageOperation(op.id)?.actions?.find((action) => action.id === 'sign')?.onSelect();
    expect(commands).toEqual([{ id: 'host.signIn' }]);
    expect(store.getSnapshot().recent[0]?.read).toBe(true);
  });
});

describe('the identity of what the slot is fed', () => {
  it('is the same object while the record is the same, with the same callbacks: a render that gets it again changes nothing', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user', progress: { current: 1, total: 4 }, onCancel: () => undefined });
    const first = store.selectors.pageOperation(op.id);
    expect(store.selectors.pageOperation(op.id)).toBe(first);
    store.notify({ title: 'Unrelated' });
    expect(store.selectors.pageOperation(op.id)).toBe(first);
    op.progress({ current: 2 });
    const next = store.selectors.pageOperation(op.id);
    expect(next).not.toBe(first);
    expect(next?.onDismiss).toBe(first?.onDismiss);
    expect(next?.actions?.[0]?.onSelect).toBe(first?.actions?.[0]?.onSelect);
  });
});

describe('letting it go', () => {
  it('rests the slot when the presenter lets the record go, and keeps the record in the history, read', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user' });
    op.succeed();
    store.selectors.pageOperation(op.id)?.onDismiss?.();
    expect(store.selectors.pageOperation(op.id)).toBeNull();
    expect(store.getSnapshot().recent[0]).toMatchObject({ inlineDismissed: true, read: true });
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('says it is a calm outcome that clears, and that a failure stays until it is dismissed: it is the presenter\'s clock, so the model only holds the flag', async () => {
    const { store, clock } = makeNotices();
    store.begin({ title: 'A', initiator: 'user' }).fail('No.');
    await clock.advance(10 * 60_000);
    expect(store.selectors.pageOperation('n1')).not.toBeNull();
  });

  it('puts the slot back when the work starts over: a restart clears the flag', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user', onRetry: () => undefined });
    op.fail('No.');
    store.dismissInline(op.id);
    expect(store.selectors.pageOperation(op.id)).toBeNull();
    op.restart();
    expect(store.selectors.pageOperation(op.id)).toMatchObject({ state: 'running' });
  });

  it('does not let go of work that is still running: only an outcome can be dismissed', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user' });
    expect(store.dismissInline(op.id)).toBe(false);
    expect(store.selectors.pageOperation(op.id)).not.toBeNull();
    expect(store.dismissInline('gone')).toBe(false);
  });

  it('says it once: dismissing what is dismissed changes nothing', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user' });
    op.succeed();
    expect(store.dismissInline(op.id)).toBe(true);
    const before = store.getSnapshot();
    expect(store.dismissInline(op.id)).toBe(false);
    expect(store.getSnapshot()).toBe(before);
  });
});

describe('one presenter (OF2, S76)', () => {
  it('is not duplicated as a toast while its own control is on screen, and is, with the same words, when the user has moved away', () => {
    const { store, inline } = makeNotices();
    inline.add('scale-button');
    const here = store.begin({ title: 'Scaling orders-api', initiator: 'user', origin: { tab: 't1', anchor: 'scale-button' } });
    const away = store.begin({ title: 'Scaling cart-api', initiator: 'user', origin: { tab: 't2', anchor: 'other-button' } });
    expect(store.getSnapshot().toasts.items.map((item) => item.id)).toEqual([away.id]);
    expect(store.selectors.pageOperation(here.id)?.text).toBe(store.selectors.record(here.id)?.phase);
    expect(store.selectors.pageOperation(away.id)?.text).toBe(store.selectors.record(away.id)?.phase);
  });
});
