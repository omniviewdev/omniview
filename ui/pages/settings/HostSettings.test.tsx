import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import type { SettingsSnapshot } from '@omniviewdev/runtime';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  value: 'startup',
  pending: false,
  listeners: new Set<(event: { data: { kind: string } }) => void>(),
  getSnapshot: vi.fn(),
  save: vi.fn(),
  warning: '',
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Events: { On: (_name: string, callback: (event: { data: { kind: string } }) => void) => {
      backend.listeners.add(callback);
      return () => backend.listeners.delete(callback);
    } },
  };
});
vi.mock('@omniviewdev/runtime/api', () => ({
  SettingsService: {
    GetSnapshot: backend.getSnapshot,
    Commit: backend.save,
    Validate: async () => ({ valid: true, message: 'Valid' }),
  },
}));
vi.mock('@omniviewdev/runtime', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  useSettings: () => ({ settings: {}, getSetting: vi.fn() }),
}));
vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
import CoreSettingsPage from './CoreSettingsPage';
import { useScopedSettings } from '@omniviewdev/runtime';

function RootSettingsConsumer() {
  const { categories } = useScopedSettings({ kind: 'host' });
  return <output>{categories.developer?.settings.futurePreference?.value as string}</output>;
}

function category(value: string) {
  return {
    id: 'developer', label: 'Developer', description: '', icon: 'LuCode',
    settings: { futurePreference: Object.assign(new Setting({ id: 'futurePreference', label: 'Future preference',
      description: '', type: SettingType.Text, value, default: 'startup', options: [] }), { requiresRestart: true, pendingRestart: backend.pending }) },
  };
}

function snapshot(): SettingsSnapshot {
  return { scope: { kind: 'host' }, categories: { developer: category(backend.value) } };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CoreSettingsPage id='developer' /></QueryClientProvider>);
  return { ...view, client };
}

async function changed() {
  await act(async () => {
    backend.listeners.forEach(callback => {
      callback({ data: { kind: 'host' } });
    }); 
  });
}

describe('host settings consumer transitions', () => {
  beforeEach(() => {
    backend.value = 'startup';
    backend.pending = false;
    backend.listeners.clear();
    backend.warning = '';
    backend.getSnapshot.mockReset().mockImplementation(async () => snapshot());
    backend.save.mockReset().mockImplementation(async (_scope: unknown, values: Record<string, string>) => {
      backend.value = values['developer.futurePreference'];
      backend.pending = backend.value !== 'startup';
      return { snapshot: snapshot(), applied: !backend.warning, uncertain: false, message: backend.warning };
    });
  });
  afterEach(cleanup);

  it('keeps drafts separate from saved pending state', async () => {
    mount();
    await screen.findByText('Requires restart');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'disabled' } });
    expect(screen.queryByText('Saved · Restart pending')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Saved · Restart pending');
    expect(screen.getByText(/Changes apply after restarting Omniview/)).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'another draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByText('Saved · Restart pending')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('disabled');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'startup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Requires restart');
    expect(screen.queryByText(/Changes apply after restarting Omniview/)).not.toBeInTheDocument();
  });

  it('refetches authorized settings after commit instead of trusting the commit snapshot', async () => {
    backend.save.mockImplementation(async (_scope: unknown, values: Record<string, string>) => {
      backend.value = values['developer.futurePreference'];
      backend.pending = true;
      return {
        snapshot: { scope: { kind: 'host' }, categories: { developer: category('commit-only value') } },
        applied: true,
        uncertain: false,
        message: '',
      };
    });
    mount();
    await screen.findByText('Requires restart');
    const readsBeforeSave = backend.getSnapshot.mock.calls.length;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'authorized value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Saved · Restart pending');
    await waitFor(() => {
      expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
      expect(backend.getSnapshot.mock.calls.length).toBeGreaterThan(readsBeforeSave);
    });
    expect(screen.getByRole('textbox')).toHaveValue('authorized value');
  });

  it('refreshes external writes and rejects an older in-flight configured response', async () => {
    const stale = Promise.withResolvers<SettingsSnapshot>();
    backend.getSnapshot.mockReturnValueOnce(stale.promise);
    mount();
    await waitFor(() => {
      expect(backend.getSnapshot).toHaveBeenCalledTimes(1);
    });
    backend.value = 'external';
    backend.pending = true;
    await changed();
    await screen.findByText('Saved · Restart pending');
    expect(screen.getByRole('textbox')).toHaveValue('external');
    await act(async () => {
      stale.resolve({ scope: { kind: 'host' }, categories: { developer: category('stale') } });
    });
    expect(screen.getByRole('textbox')).toHaveValue('external');
  });

  it('refreshes root configured reads without allowing stale external responses', async () => {
    const stale = Promise.withResolvers<SettingsSnapshot>();
    backend.getSnapshot.mockReturnValueOnce(stale.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RootSettingsConsumer /></QueryClientProvider>);
    await waitFor(() => {
      expect(backend.getSnapshot).toHaveBeenCalledTimes(1);
    });
    backend.value = 'external root';
    await changed();
    await screen.findByText('external root');
    await act(async () => {
      stale.resolve({ scope: { kind: 'host' }, categories: { developer: category('stale root') } });
    });
    expect(screen.getByText('external root')).toBeVisible();
    expect(screen.queryByText('stale root')).not.toBeInTheDocument();
  });


  it('retains unsaved drafts when persistence fails without inventing pending state', async () => {
    backend.save.mockRejectedValue(new Error('Storage unavailable'));
    mount();
    await screen.findByText('Requires restart');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Could not save. Check the value and try again.');
    expect(screen.getByRole('textbox')).toHaveValue('unsaved');
    expect(screen.queryByText('Saved · Restart pending')).not.toBeInTheDocument();
  });

  it('reports durable save with failed application instead of claiming persistence failed', async () => {
    const message = 'Settings were saved but could not be applied. Restart Omniview to load the saved configuration.';
    backend.warning = message;
    mount();
    await screen.findByText('Requires restart');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'durable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Could not save. Check the value and try again.')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('durable');
    expect(screen.getByText('Saved · Restart pending')).toBeVisible();
  });

});
