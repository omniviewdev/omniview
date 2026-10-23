import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  values: vi.fn(),
  listeners: new Map<string, Set<(event: { data: { id: string } }) => void>>(),
}));

vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({ GetPluginMeta: mocks.metadata }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/settings/servicewrapper', () => ({ PluginValues: mocks.values }));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof WailsRuntime>();
  return {
    ...original,
    Events: {
      ...original.Events,
      On: (name: string, callback: (event: { data: { id: string } }) => void) => {
        let listeners = mocks.listeners.get(name);
        if (!listeners) mocks.listeners.set(name, listeners = new Set());
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
  };
});

import { PluginMeta } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/config/models';
import { PluginContextProvider } from './PluginContextProvider';
import { usePluginContext } from './usePluginContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Consumer() {
  const { meta, settings } = usePluginContext();
  return <><h1>{meta.name}</h1><output aria-label="Plugin counter">{settings.counter}</output></>;
}

function published() {
  for (const listener of mocks.listeners.get('plugin/dev_install_complete') ?? []) {
    listener({ data: { id: 'probe' } });
  }
}

describe('plugin metadata after managed source publication', () => {
  beforeEach(() => {
    mocks.metadata.mockReset();
    mocks.values.mockReset().mockResolvedValue({ counter: 17 });
    mocks.listeners.clear();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('opens the existing route when source publication follows an initial missing-plugin response', async () => {
    mocks.metadata
      .mockRejectedValueOnce(new Error("plugin 'probe' not found"))
      .mockResolvedValue(new PluginMeta({ id: 'probe', name: 'Recovered plugin' }));
    render(<PluginContextProvider pluginId="probe"><Consumer /></PluginContextProvider>);
    await screen.findByText("plugin 'probe' not found");
    expect(screen.queryByLabelText('Plugin counter')).toBeNull();

    await act(async () => published());

    expect((await screen.findByRole('heading', { name: 'Recovered plugin' })).textContent).toBe('Recovered plugin');
    expect(screen.getByLabelText('Plugin counter').textContent).toBe('17');
  });

  it('keeps current metadata and settings when older startup responses finish afterward', async () => {
    const initialMetadata = deferred<PluginMeta>();
    const initialSettings = deferred<Record<string, unknown>>();
    mocks.metadata
      .mockReturnValueOnce(initialMetadata.promise)
      .mockResolvedValue(new PluginMeta({ id: 'probe', name: 'Current plugin' }));
    mocks.values.mockReturnValueOnce(initialSettings.promise).mockResolvedValue({ counter: 29 });
    render(<PluginContextProvider pluginId="probe"><Consumer /></PluginContextProvider>);
    await act(async () => published());
    await screen.findByRole('heading', { name: 'Current plugin' });

    await act(async () => {
      initialMetadata.reject(new Error('Superseded startup failure'));
      initialSettings.resolve({ counter: 2 });
      await initialMetadata.promise.catch(() => undefined);
      await initialSettings.promise;
    });

    expect(screen.getByRole('heading', { name: 'Current plugin' }).textContent).toBe('Current plugin');
    expect(screen.getByLabelText('Plugin counter').textContent).toBe('29');
  });

  it('recovers the consumer through Retry without a publication event', async () => {
    mocks.metadata
      .mockRejectedValueOnce(new Error('Metadata unavailable'))
      .mockResolvedValue(new PluginMeta({ id: 'probe', name: 'Retry recovered plugin' }));
    render(<PluginContextProvider pluginId="probe"><Consumer /></PluginContextProvider>);
    await screen.findByText('Metadata unavailable');
    expect(screen.queryByLabelText('Plugin counter')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('heading', { name: 'Retry recovered plugin' });
    expect(screen.getByLabelText('Plugin counter').textContent).toBe('17');
  });
});
