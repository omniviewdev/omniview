import { describe, expect, it } from 'vitest';
import { incompatibleFailure } from '../../../plugins/loader/failure';
import { actionsOf, type Actions } from './availability';
import { stateOf } from './state';
import type { Installed, Operation } from './types';

// What a person can do to a plugin now, and why not when they cannot (S2: a function that cannot run says why). Each answer follows what the host can truthfully do (docs/ui-next/status/PL1.md, "What the backend can tell the
// page"): a plugin that is turned off cannot be reloaded (the host would say it starts again and never start it), a plugin the product ships cannot be uninstalled, and nothing is started on a plugin while the host or this page is
// already working on it.

const plugin = (patch: Partial<Installed> = {}): Installed => ({
  id: 'alpha',
  name: 'Alpha Metrics',
  version: '1.8.2',
  description: '',
  publisher: '',
  license: '',
  category: '',
  repository: '',
  website: '',
  tags: [],
  dependencies: [],
  capabilities: [],
  builtin: false,
  enabled: true,
  devMode: false,
  releaseChannel: '',
  phase: 'Running',
  ...patch,
});

const actions = (installed: Installed, op: Operation | null = null) => actionsOf(installed, stateOf({ installed, entry: undefined, removing: false }), op);
const can = { available: true } as const;

describe('a plugin that is running', () => {
  it('can be reloaded, turned off and uninstalled, and has nothing to retry or turn on', () => {
    expect(actions(plugin())).toEqual({
      retry: { available: false, reason: 'It has not failed.' },
      reload: can,
      enable: { available: false, reason: 'It is already enabled.' },
      disable: can,
      uninstall: can,
    });
  });

  it('is the same when it runs with errors', () => {
    expect(actions(plugin({ phase: 'Degraded' }))).toMatchObject({ reload: can, disable: can, uninstall: can });
  });
});

describe('a plugin that is turned off', () => {
  it('can be turned on and uninstalled, and cannot be reloaded: the host would say it starts and never start it', () => {
    expect(actions(plugin({ enabled: false, phase: 'Installed' }))).toMatchObject({
      reload: { available: false, reason: 'Enable it first.' },
      enable: can,
      disable: { available: false, reason: 'It is already disabled.' },
      uninstall: can,
    });
  });

  it('is not reloaded whatever state the page holds for it: the rule is the plugin\'s flag, not the word', () => {
    const running = stateOf({ installed: plugin(), entry: undefined, removing: false });

    expect(actionsOf(plugin({ enabled: false, phase: 'Installed' }), running, null).reload).toEqual({ available: false, reason: 'Enable it first.' });
  });
});

describe('a plugin that failed', () => {
  it('can be retried, turned off and uninstalled, and is not reloaded: its retry is the same call', () => {
    expect(actions(plugin({ phase: 'Failed' }))).toMatchObject({ retry: can, reload: { available: false, reason: 'Use Retry.' }, disable: can, uninstall: can });
  });
});

describe('a plugin the host refused for the protocol it speaks (S4)', () => {
  const refused = (): Actions => {
    const installed = plugin({ phase: 'Failed' });
    const entry = { id: 'alpha', name: 'Alpha Metrics', phase: 'failed', failure: incompatibleFailure({ pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } }) } as const;
    return actionsOf(installed, stateOf({ installed, entry, removing: false }), null);
  };

  it('is not retried and is not reloaded, and says why: the same process would say the same number, so asking again cannot help', () => {
    expect(refused()).toMatchObject({
      retry: { available: false, reason: 'The host will not run it, and asking again cannot help.' },
      reload: { available: false, reason: 'It is not running.' },
    });
  });

  it('can still be turned off and uninstalled', () => {
    expect(refused()).toMatchObject({ disable: can, uninstall: can });
  });
});

describe('a plugin that is stopped', () => {
  it('can be started again, which is a reload', () => {
    expect(actions(plugin({ phase: 'Stopped' }))).toMatchObject({ reload: can });
  });
});

describe('a plugin the host or this page is working on', () => {
  it.each(['Starting', 'Stopping', 'Recovering', 'Uninstalling'])('cannot be changed while the host holds it in the phase %s', (phase) => {
    const reason = 'Wait for it to finish.';

    expect(actions(plugin({ phase }))).toEqual({
      retry: { available: false, reason },
      reload: { available: false, reason },
      enable: { available: false, reason },
      disable: { available: false, reason },
      uninstall: { available: false, reason },
    });
  });

  it.each<Operation>(['reload', 'enable', 'disable', 'uninstall'])('cannot be changed while this page is running %s on it', (op) => {
    const reason = 'Wait for the running operation to finish.';
    const result = actions(plugin({ enabled: op !== 'disable' }), op);

    expect(result.reload).toEqual({ available: false, reason });
    expect(result.uninstall).toEqual({ available: false, reason });
    expect(result.retry).toEqual({ available: false, reason });
  });
});

describe('a plugin the product ships', () => {
  it('can be turned off and reloaded and cannot be uninstalled, and says why', () => {
    expect(actions(plugin({ builtin: true }))).toMatchObject({ reload: can, disable: can, uninstall: { available: false, reason: 'Built into Omniview. Disable it instead.' } });
  });
});
