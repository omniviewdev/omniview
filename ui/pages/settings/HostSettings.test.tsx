import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import type { Category } from '@omniviewdev/runtime/models';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  value: 'startup',
  pending: false,
  listeners: new Set<(event: { data: string }) => void>(),
  getCategory: vi.fn(),
  getList: vi.fn(),
  getStates: vi.fn(),
  getStatus: vi.fn(),
  save: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Events: { On: (_name: string, callback: (event: { data: string }) => void) => {
      backend.listeners.add(callback);
      return () => backend.listeners.delete(callback);
    } },
  };
});
vi.mock('@omniviewdev/runtime/api', () => ({
  SettingsProvider: {
    GetCategory: backend.getCategory,
    ListSettings: backend.getList,
    GetSettingStates: backend.getStates,
    SetSettings: backend.save,
    ValidateSetting: async () => ({ valid: true, message: 'Valid' }),
  },
  HostProfiling: { GetStatus: backend.getStatus },
}));
vi.mock('@omniviewdev/runtime', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  useSettings: () => ({ reload: vi.fn() }),
  useSnackbar: () => ({ showSnackbar: backend.snackbar }),
}));
vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
import CoreSettingsPage from './CoreSettingsPage';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';

function RootSettingsConsumer() {
  const { settings } = useSettingsProvider();
  return <output>{settings.data?.developer?.settings.futurePreference?.value as string}</output>;
}

function category(value: string) {
  return {
    id: 'developer', label: 'Developer', description: '', icon: 'LuCode',
    settings: { futurePreference: new Setting({ id: 'futurePreference', label: 'Future preference',
      description: '', type: SettingType.Text, value, default: 'startup', options: [] }) },
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CoreSettingsPage id='developer' /></QueryClientProvider>);
  return { ...view, client };
}

async function changed() {
  await act(async () => {
    backend.listeners.forEach(callback => {
      callback({ data: 'developer' }); 
    }); 
  });
}

describe('host settings consumer transitions', () => {
  beforeEach(() => {
    backend.value = 'startup';
    backend.pending = false;
    backend.listeners.clear();
    backend.getList.mockReset().mockImplementation(async () => ({ developer: category(backend.value) }));
    backend.getCategory.mockReset().mockImplementation(async () => category(backend.value));
    backend.getStates.mockReset().mockImplementation(async () => ({
      'developer.futurePreference': { requiresRestart: true, pendingRestart: backend.pending },
    }));
    backend.getStatus.mockReset().mockResolvedValue({ running: true, url: 'http://127.0.0.1:43210/debug/pprof/', source: 'settings', error: '' });
    backend.save.mockReset().mockImplementation(async (values: Record<string, string>) => {
      backend.value = values['developer.futurePreference'];
      backend.pending = backend.value !== 'startup';
    });
  });
  afterEach(cleanup);

  it('keeps drafts separate from saved pending state and leaves actual listener active', async () => {
    mount();
    await screen.findByText('Requires restart');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'disabled' } });
    expect(screen.queryByText('Saved · Restart pending')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Saved · Restart pending');
    expect(screen.getByText(/Changes apply after restarting Omniview/)).toBeVisible();
    expect(screen.getByText('http://127.0.0.1:43210/debug/pprof/')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'another draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByText('Saved · Restart pending')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('disabled');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'startup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Requires restart');
    expect(screen.queryByText(/Changes apply after restarting Omniview/)).not.toBeInTheDocument();
  });

  it('refreshes external writes and rejects an older in-flight configured response', async () => {
    const stale = Promise.withResolvers<Category>();
    backend.getCategory.mockReturnValueOnce(stale.promise);
    mount();
    await waitFor(() => {
      expect(backend.getCategory).toHaveBeenCalledTimes(1); 
    });
    backend.value = 'external';
    backend.pending = true;
    await changed();
    await screen.findByText('Saved · Restart pending');
    expect(screen.getByRole('textbox')).toHaveValue('external');
    await act(async () => {
      stale.resolve(category('stale')); 
    });
    expect(screen.getByRole('textbox')).toHaveValue('external');
  });

  it('refreshes root configured reads without allowing stale external responses', async () => {
    const stale = Promise.withResolvers<Record<string, Category>>();
    backend.getList.mockReturnValueOnce(stale.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RootSettingsConsumer /></QueryClientProvider>);
    await waitFor(() => {
      expect(backend.getList).toHaveBeenCalledTimes(1); 
    });
    backend.value = 'external root';
    await changed();
    await screen.findByText('external root');
    await act(async () => {
      stale.resolve({ developer: category('stale root') }); 
    });
    expect(screen.getByText('external root')).toBeVisible();
    expect(screen.queryByText('stale root')).not.toBeInTheDocument();
  });

  it('rejects stale restart metadata after an external write', async () => {
    const stale = Promise.withResolvers<Record<string, { requiresRestart: boolean; pendingRestart: boolean }>>();
    backend.getStates.mockReturnValueOnce(stale.promise);
    mount();
    await screen.findByRole('textbox');
    backend.pending = true;
    await changed();
    await screen.findByText('Saved · Restart pending');
    await act(async () => {
      stale.resolve({
        'developer.futurePreference': { requiresRestart: true, pendingRestart: false },
      }); 
    });
    expect(screen.getByText('Saved · Restart pending')).toBeVisible();
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
    backend.save.mockImplementation(async (values: Record<string, string>) => {
      backend.value = values['developer.futurePreference'];
      backend.pending = true;
      throw new Error(message);
    });
    backend.snackbar.mockClear();
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
    expect(backend.snackbar).toHaveBeenCalledWith(message, 'error');
    expect(backend.snackbar).not.toHaveBeenCalledWith('Settings saved', 'success');
  });

  it('shows override and serve failure without claiming a listener URL', async () => {
    backend.getStatus.mockResolvedValue({ running: false, url: '', source: 'environment', error: 'Port unavailable' });
    mount();
    await screen.findByText('Port unavailable');
    expect(screen.getByText(/OMNIVIEW_PPROF_PORT overrides saved preferences/)).toBeVisible();
    expect(screen.getByText('Listener not running')).toBeVisible();
    expect(screen.queryByText(/Active URL:/)).not.toBeInTheDocument();
  });

  it('polls listener facts only while the developer page is visible', async () => {
    vi.useFakeTimers();
    try {
      const { rerender, client } = mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1); 
      });
      expect(screen.getByText('Listener running')).toBeVisible();
      backend.getStatus.mockResolvedValue({ running: false, url: '', source: 'settings', error: 'Listener stopped' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5001); 
      });
      expect(screen.getByText('Listener stopped')).toBeVisible();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      fireEvent(document, new Event('visibilitychange'));
      const hiddenCalls = backend.getStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000); 
      });
      expect(backend.getStatus).toHaveBeenCalledTimes(hiddenCalls);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      fireEvent(document, new Event('visibilitychange'));
      rerender(<QueryClientProvider client={client}><CoreSettingsPage id='other' /></QueryClientProvider>);
      const otherPageCalls = backend.getStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000); 
      });
      expect(backend.getStatus).toHaveBeenCalledTimes(otherPageCalls);
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      vi.useRealTimers();
    }
  });
});
