import { describe, expect, it, vi } from 'vitest';
import { unloadedFailure } from '../../../plugins/loader/failure';
import { createPluginsModel, type PluginsModel } from './model';
import { harness, inventoryEntry, settle, type Harness } from './testing';
import type { InventoryEntry } from './types';

// The five things the page does to a plugin, against the host's calls as spies: Reload, Retry, Enable, Disable and Uninstall. What each rests on (docs/ui-next/status/PL1.md): a reload is the host stopping the plugin and starting it
// again; turning a plugin ON only persists the choice, so Enable is that call and then a reload; the plugin's state is what the host's events and the read after the call say, never what the page hopes for; and a call that fails
// is told through the host, with a Retry that runs the same call again.

const plugins = [inventoryEntry('alpha'), inventoryEntry('beta', { enabled: false, phase: 'Installed' }), inventoryEntry('gamma', { phase: 'Failed' }), inventoryEntry('product', { origin: 'builtin' })];

async function opened(list: readonly InventoryEntry[] = plugins): Promise<Harness & { readonly model: PluginsModel }> {
  const set = harness(list);
  const model = createPluginsModel(set.deps);
  model.attach();
  await settle();
  set.read.mockClear();
  return { ...set, model };
}

/** A call that stays out until the test lets it end. */
function pending(): { readonly call: () => Promise<unknown>; readonly end: () => void; readonly fail: (error: unknown) => void } {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  return {
    call: async () => promise,
    end: () => {
      resolve(undefined);
    },
    fail: (error) => {
      reject(error);
    },
  };
}

describe('Reload', () => {
  it('says the work is going on from the press until the host answers, and does it once', async () => {
    const { model, actions } = await opened();
    const call = pending();
    actions.reload.mockImplementationOnce(call.call);

    model.reload('alpha');
    model.reload('alpha');

    expect(actions.reload).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(model.row('alpha')?.op).toBe('reload');
    expect(model.row('alpha')?.actions.reload).toEqual({ available: false, reason: 'Wait for the running operation to finish.' });

    call.end();
    await settle();

    expect(model.row('alpha')?.op).toBeNull();
  });

  it('does not say what the plugin came to: the row says what the host\'s events say, and the host is read again when the call ends', async () => {
    const { model, actions, read, events } = await opened();
    const call = pending();
    actions.reload.mockImplementationOnce(call.call);

    model.reload('alpha');
    events.emit('plugin/state_change', { pluginID: 'alpha', from: 'Running', to: 'Stopped' });
    events.emit('plugin/state_change', { pluginID: 'alpha', from: 'Starting', to: 'Running' });

    expect(model.row('alpha')?.state.kind).toBe('running');
    expect(read).not.toHaveBeenCalled();

    call.end();
    await settle();

    expect(read).toHaveBeenCalledOnce();
  });

  it('is told through the host when the call fails, and the row is read again: what the host says is the truth', async () => {
    const { model, actions, fail, read } = await opened();
    const error = new Error('the host said no');
    actions.reload.mockRejectedValueOnce(error);

    model.reload('alpha');
    await settle();

    expect(model.row('alpha')?.op).toBeNull();
    expect(fail).toHaveBeenCalledOnce();
    expect(fail.mock.calls[0]?.[0]).toMatchObject({ operation: 'reload', id: 'alpha', name: 'Alpha', error });
    expect(read).toHaveBeenCalledOnce();
  });

  it('runs the same call again when the person retries what failed', async () => {
    const { model, actions, fail } = await opened();
    actions.reload.mockRejectedValueOnce(new Error('the host said no'));
    model.reload('alpha');
    await settle();

    fail.mock.calls[0]?.[0].retry();
    await settle();

    expect(actions.reload).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledOnce();
  });

  it('is not done to a plugin that is turned off: the host would say it starts again and never start it', async () => {
    const { model, actions } = await opened();

    model.reload('beta');

    expect(actions.reload).not.toHaveBeenCalled();
    expect(model.row('beta')?.op).toBeNull();
  });

  it('is not done to a plugin that is not listed', async () => {
    const { model, actions } = await opened();

    model.reload('nobody');

    expect(actions.reload).not.toHaveBeenCalled();
  });
});

describe('Enable', () => {
  it('persists the choice and then reloads, in that order and one after the other: the host does not start a plugin that is turned on', async () => {
    const { model, actions } = await opened();
    const order: string[] = [];
    const first = pending();
    actions.setEnabled.mockImplementationOnce(async (id, enabled) => {
      order.push(`setEnabled ${id} ${String(enabled)}`);
      await first.call();
    });
    actions.reload.mockImplementationOnce(async (id) => {
      order.push(`reload ${id}`);
      await Promise.resolve();
    });

    model.enable('beta');

    expect(order).toEqual(['setEnabled beta true']);
    expect(model.row('beta')?.op).toBe('enable');

    first.end();
    await settle();

    expect(order).toEqual(['setEnabled beta true', 'reload beta']);
    expect(model.row('beta')?.op).toBeNull();
  });

  it('does not reload when the choice could not be saved, and says it could not enable', async () => {
    const { model, actions, fail } = await opened();
    actions.setEnabled.mockRejectedValueOnce(new Error('not saved'));

    model.enable('beta');
    await settle();

    expect(actions.reload).not.toHaveBeenCalled();
    expect(fail.mock.calls[0]?.[0]).toMatchObject({ operation: 'enable', id: 'beta', name: 'Beta' });
  });

  it('says it could not enable when the plugin was turned on and did not start: the plugin is on, and the failure is the row\'s to say', async () => {
    const { model, actions, fail } = await opened();
    actions.reload.mockRejectedValueOnce(new Error('did not start'));

    model.enable('beta');
    await settle();

    expect(actions.setEnabled).toHaveBeenCalledExactlyOnceWith('beta', true);
    expect(fail.mock.calls[0]?.[0]).toMatchObject({ operation: 'enable', id: 'beta' });
    expect(model.row('beta')?.op).toBeNull();
  });

  it('is not done to a plugin that is on', async () => {
    const { model, actions } = await opened();

    model.enable('alpha');

    expect(actions.setEnabled).not.toHaveBeenCalled();
  });
});

describe('Disable', () => {
  it('persists the choice', async () => {
    const { model, actions } = await opened();
    const call = pending();
    actions.setEnabled.mockImplementationOnce(call.call);

    model.disable('alpha');

    expect(actions.setEnabled).toHaveBeenCalledExactlyOnceWith('alpha', false);
    expect(model.row('alpha')?.op).toBe('disable');

    call.end();
    await settle();

    expect(model.row('alpha')?.op).toBeNull();
  });

  it('is told through the host when it fails', async () => {
    const { model, actions, fail } = await opened();
    actions.setEnabled.mockRejectedValueOnce(new Error('not saved'));

    model.disable('alpha');
    await settle();

    expect(fail.mock.calls[0]?.[0]).toMatchObject({ operation: 'disable', id: 'alpha' });
  });

  it('is not done to a plugin that is off', async () => {
    const { model, actions } = await opened();

    model.disable('beta');

    expect(actions.setEnabled).not.toHaveBeenCalled();
  });
});

describe('Uninstall', () => {
  it('asks the host, and the plugin leaves the list when the host says it was uninstalled, not when the call ends', async () => {
    const { model, actions, events, list } = await opened();
    const call = pending();
    actions.uninstall.mockImplementationOnce(call.call);

    model.uninstall('alpha');

    expect(actions.uninstall).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(model.row('alpha')?.op).toBe('uninstall');
    expect(model.getSnapshot().ids).toContain('alpha');

    events.emit('plugin/unloaded', { pluginID: 'alpha', cause: 'uninstalled' });

    expect(model.getSnapshot().ids).not.toContain('alpha');

    // The host no longer lists it, and says so to whoever reads it when the call ends.
    list.current = plugins.filter((entry) => entry.id !== 'alpha');
    call.end();
    await settle();

    expect(model.getSnapshot().ids).not.toContain('alpha');
  });

  it('puts the plugin back, as the host lists it, when the uninstall fails after the host said it was gone', async () => {
    const { model, actions, events, fail, list } = await opened();
    const call = pending();
    actions.uninstall.mockImplementationOnce(call.call);
    model.uninstall('alpha');
    events.emit('plugin/unloaded', { pluginID: 'alpha', cause: 'uninstalled' });

    // The host rolled the uninstall back: it lists the plugin, stopped.
    list.current = plugins.map((entry) => (entry.id === 'alpha' ? { ...entry, phase: 'Stopped' } : entry));
    call.fail(new Error('could not remove'));
    await settle();

    expect(model.getSnapshot().ids).toContain('alpha');
    expect(model.row('alpha')?.state.kind).toBe('stopped');
    expect(fail.mock.calls[0]?.[0]).toMatchObject({ operation: 'uninstall', id: 'alpha' });
  });

  it('is not done to the product\'s own plugin', async () => {
    const { model, actions } = await opened();

    model.uninstall('product');

    expect(actions.uninstall).not.toHaveBeenCalled();
  });

  it('is not done to a plugin the page is already working on', async () => {
    const { model, actions } = await opened();
    actions.setEnabled.mockImplementationOnce(pending().call);

    model.disable('alpha');
    model.uninstall('alpha');

    expect(actions.uninstall).not.toHaveBeenCalled();
  });
});

describe('Retry', () => {
  it('is the window\'s own Retry for a plugin the window holds as failed: one model for a failure, the rail\'s', async () => {
    const { model, entries, retry, actions } = await opened();
    entries.set([{ id: 'gamma', name: 'Gamma', phase: 'failed', failure: unloadedFailure('failed') }]);

    model.retry('gamma');

    expect(retry).toHaveBeenCalledExactlyOnceWith('gamma');
    expect(actions.reload).not.toHaveBeenCalled();
  });

  it('asks the host directly for a plugin the window does not hold', async () => {
    const { model, retry, actions } = await opened();

    model.retry('gamma');

    expect(retry).not.toHaveBeenCalled();
    expect(actions.reload).toHaveBeenCalledExactlyOnceWith('gamma');
    expect(model.row('gamma')?.op).toBe('reload');
  });

  it('is the window\'s Retry as the window last gave it: the window hands a new one whenever its list of plugins changes', async () => {
    const { model, entries, retry } = await opened();
    entries.set([{ id: 'gamma', name: 'Gamma', phase: 'failed', failure: unloadedFailure('failed') }]);
    const current = vi.fn();
    model.setRetry(current);

    model.retry('gamma');

    expect(current).toHaveBeenCalledExactlyOnceWith('gamma');
    expect(retry).not.toHaveBeenCalled();
  });

  it('is not done to a plugin that has not failed', async () => {
    const { model, retry, actions } = await opened();

    model.retry('alpha');

    expect(retry).not.toHaveBeenCalled();
    expect(actions.reload).not.toHaveBeenCalled();
  });
});

describe('a call that outlives what asked for it', () => {
  it('still tells the host\'s notices when it fails, with the page long gone', async () => {
    const { model, actions, fail } = await opened();
    const call = pending();
    actions.reload.mockImplementationOnce(call.call);
    const listener = vi.fn();
    const stop = model.subscribeRow('alpha', listener);
    model.reload('alpha');
    stop();

    call.fail(new Error('late'));
    await settle();

    expect(fail).toHaveBeenCalledOnce();
  });
});
