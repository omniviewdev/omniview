import React from 'react';
import SettingsEntries from './SettingsEntries';
import { Section, SettingsFocusContext } from './settingsContext';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtensionPointRegistry, ExtensionProvider } from '@omniviewdev/runtime';
import { Category, Setting, SettingType } from '@omniviewdev/runtime/models';
import type * as RuntimeCore from '@omniviewdev/runtime';
import type * as AppThemeController from '@/theme/AppThemeController';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';
import type * as RuntimeEvents from '@omniviewdev/runtime/runtime';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsWindowShell } from '@/features/windows/SettingsWindowShell';

type NativeSettingsState = { requestId: number; target: string; visible: boolean };
const mocks = vi.hoisted(() => ({
  setSettings: vi.fn(), selectTheme: vi.fn(),
  getWindowState: vi.fn(), setWindowLocation: vi.fn(), hideSettings: vi.fn(),
  stateListener: undefined as ((event: { data: NativeSettingsState }) => void) | undefined,
}));
const categories = {
  general: new Category({
    id: 'general', label: 'General', icon: 'LuSettings',
    settings: {
      first: new Setting({ id: 'first', label: 'First option', type: SettingType.Text, value: 'one' }),
      second: new Setting({ id: 'second', label: 'Second option', type: SettingType.Text, value: 'two' }),
    },
  }),
  appearance: new Category({
    id: 'appearance', label: 'Appearance', icon: 'LuPaintbrush',
    settings: { theme: new Setting({ id: 'theme', label: 'Theme', type: SettingType.Select, value: 'dark' }) },
  }),
  developer: new Category({
    id: 'developer', label: 'Developer', icon: 'LuCode',
    settings: {
      pprof_port: new Setting({
        id: 'pprof_port', label: 'Verbose backend profiling port',
        description: 'Verbose backend profiling description',
        type: SettingType.Integer, value: 6060,
      }),
    },
  }),
};
const plugin = { id: 'probe', metadata: { name: 'Native probe', description: 'Private native plugin', icon: 'LuSettings' } };

vi.mock('@/hooks/plugin/usePluginManager', () => ({
  usePluginManager: () => ({ plugins: { data: [plugin], isLoading: false } }),
  usePlugin: () => ({ plugin: { data: plugin, isLoading: false } }),
}));
vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
vi.mock('@/theme/AppThemeController', async (importOriginal) => {
  const actual = await importOriginal<typeof AppThemeController>();
  return { ...actual, useAppTheme: () => ({ requestedThemeId: 'dark', selectTheme: mocks.selectTheme }) };
});
vi.mock('@omniviewdev/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeCore>();
  return { ...actual, useScopedSettings: (scope: { kind: string }) => ({
    categories: scope.kind === 'host' ? categories : { plugin: { settings: {
      endpoint: new Setting({ id: 'endpoint', label: 'Endpoint', type: SettingType.Text, value: 'native' }),
    } } },
    isLoading: false, error: null, commit: mocks.setSettings,
    validate: async () => ({ valid: true, message: '' }),
  }) };
});
vi.mock('@omniviewdev/runtime/api', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeAPI>();
  return { ...actual, WindowClient: {
    ...actual.WindowClient,
    GetSettingsState: mocks.getWindowState,
    SetSettingsLocation: mocks.setWindowLocation,
    HideSettings: mocks.hideSettings,
  } };
});
vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeEvents>();
  return { ...actual, Events: { ...actual.Events,
    On: (name: string, callback: (event: { data: NativeSettingsState }) => void) => {
      if (name === 'settings/state') {
        mocks.stateListener = callback;
      }

      return () => {
        if (mocks.stateListener === callback) {
          mocks.stateListener = undefined;
        }
      };
    },
  } };
});

import SettingsPage from './index';

function renderSettings(initial = '/settings?category=general') {
  const registry = new ExtensionPointRegistry();
  registry.addExtensionPoint({ id: 'probe/settings-proof', pluginId: 'probe', mode: 'multiple' });
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: [initial] });
  const view = render(<ExtensionProvider registry={registry}><RouterProvider router={router} /></ExtensionProvider>);
  return { router, registry, ...view };
}

function renderSettingsWindow() {
  window.history.replaceState(null, '', '/#/settings?category=general');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const registry = new ExtensionPointRegistry();
  return render(<QueryClientProvider client={queryClient}>
    <ExtensionProvider registry={registry}><SettingsWindowShell /></ExtensionProvider>
  </QueryClientProvider>);
}

async function expectFocusedSetting(label: string, fullId: string) {
  await waitFor(() => {
    const row = screen.getByText(label).closest('[data-setting-id]');
    expect(row).toHaveAttribute('data-setting-id', fullId);
    expect(row?.id).toBe(`setting-${encodeURIComponent(fullId)}`);
    expect(row === document.activeElement || row?.contains(document.activeElement)).toBe(true);
  });
}

beforeEach(() => {
  mocks.setSettings.mockReset().mockResolvedValue({ applied: true, uncertain: false, message: '' });
  mocks.selectTheme.mockReset().mockResolvedValue(undefined);
  mocks.getWindowState.mockReset().mockResolvedValue({ requestId: 7, target: '/settings?category=general', visible: true });
  mocks.setWindowLocation.mockReset().mockResolvedValue(undefined);
  mocks.hideSettings.mockReset().mockResolvedValue(undefined);
  mocks.stateListener = undefined;
});
afterEach(cleanup);

describe('actual SettingsPage query-driven navigation', () => {
  it('retains legacy category URLs, follows a same-page category change and focuses the real Theme editor', async () => {
    const { router } = renderSettings();
    expect(screen.getByText('First option')).toBeVisible();
    await act(async () => {
      await router.navigate('/settings?category=appearance&setting=appearance.theme');
    });
    expect(screen.queryByText('First option')).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expectFocusedSetting('Theme', 'appearance.theme');
    expect(mocks.selectTheme).not.toHaveBeenCalled();
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });

  it('updates the exact focus target without remounting the already-selected category', async () => {
    const { router } = renderSettings('/settings?section=core&category=general&setting=general.first');
    await expectFocusedSetting('First option', 'general.first');
    const firstRow = screen.getByText('First option').closest('[data-setting-id]');
    await act(async () => {
      await router.navigate('/settings?section=core&category=general&setting=general.second');
    });
    expect(screen.getByText('First option').closest('[data-setting-id]')).toBe(firstRow);
    await expectFocusedSetting('Second option', 'general.second');
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });

  it('focuses the profiling editor rather than its keyboard-accessible help button', async () => {
    const user = userEvent.setup();
    const target = '/settings?category=developer&setting=developer.pprof_port';
    const { router } = renderSettings(target);
    const row = screen.getByRole('group', { name: 'Profiling port' });
    const editor = within(row).getByRole('spinbutton');
    const help = within(row).getByRole('button', { name: 'Profiling port help' });

    await waitFor(() => expect(editor).toHaveFocus());
    expect(help).not.toHaveAttribute('tabindex', '-1');
    expect(screen.queryByText('Verbose backend profiling description')).not.toBeInTheDocument();

    await user.tab({ shift: true });
    expect(help).toHaveFocus();
    expect(await screen.findByText('Use 0 to choose an available port automatically.')).toBeVisible();

    await act(async () => {
      await router.navigate(target);
    });
    await waitFor(() => expect(editor).toHaveFocus());
    expect(help).not.toHaveFocus();
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });

  it('selects actual plugin settings from the explicit section/plugin query and focuses only its setting', async () => {
    renderSettings('/settings?section=plugins&plugin=probe&setting=endpoint');
    expect(screen.getByText('Endpoint')).toBeVisible();
    await expectFocusedSetting('Endpoint', 'endpoint');
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });

  it('opens the extension manager from section-only navigation and exposes a real registered point', () => {
    const { registry } = renderSettings('/settings?section=extensions');
    expect(screen.getByRole('button', { name: 'probe/settings-proof' })).toBeVisible();
    expect(registry.getExtensionPoint('probe/settings-proof')).toBeDefined();
  });

  it('shows safe unavailable feedback for a removed exact focus target without changing any setting', async () => {
    renderSettings('/settings?category=general&setting=general.removed');
    expect(await screen.findByText(/unavailable/i)).toBeVisible();
    expect(mocks.setSettings).not.toHaveBeenCalled();
    expect(mocks.selectTheme).not.toHaveBeenCalled();
  });

  it.each([
    '/settings?section=ai-tools&setting=enabled',
    '/settings?section=core&category=ai-tools&setting=enabled',
  ])('rejects unsupported AI Tools focus without breaking later valid navigation: %s', async (url) => {
    const { router } = renderSettings(url);
    expect(screen.getByText('Requested settings are unavailable.')).toBeVisible();
    await act(async () => router.navigate('/settings?category=general&setting=general.first'));
    await expectFocusedSetting('First option', 'general.first');
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });
});

it('refocuses the actual Theme editor when navigation requests the same already-mounted settings URL again', async () => {
  const target = '/settings?category=appearance&setting=appearance.theme';
  const { router } = renderSettings(target);
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
  });
  const editor = screen.getByRole('radio', { name: 'Dark' });
  editor.blur();
  await act(async () => {
    await router.navigate(target); 
  });
  await waitFor(() => {
    expect(editor).toHaveFocus(); 
  });
  expect(mocks.setSettings).not.toHaveBeenCalled();
  expect(mocks.selectTheme).not.toHaveBeenCalled();
});

it('guards search navigation and retains drafts after Cancel and failed Save', async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.type(screen.getByRole('textbox', { name: 'First option' }), ' draft');
  await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'Endpoint');
  await user.click(screen.getByRole('button', { name: /Native probe Endpoint/ }));
  let dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Native probe Endpoint/ }));
  mocks.setSettings.mockRejectedValueOnce(new Error('offline'));
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  await user.clear(screen.getByRole('searchbox'));
  expect(screen.getByRole('textbox', { name: 'First option' })).toHaveValue('one draft');
  expect(screen.getAllByText('Could not save. Check the value and try again.').length).toBeGreaterThan(0);
});

it('keeps guard keyboard focus inside the dialog and retains drafts on Escape', async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.type(screen.getByRole('textbox', { name: 'First option' }), ' draft');
  await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'Endpoint');
  await user.click(screen.getByRole('button', { name: /Native probe Endpoint/ }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveFocus();
  const escapedFocus: EventTarget[] = [];
  const recordFocus = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && !dialog.contains(event.target)) {
      escapedFocus.push(event.target);
    }
  };

  document.addEventListener('focusin', recordFocus, true);
  try {
    await user.keyboard(/mac/i.test(navigator.userAgent) ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}');
    expect(escapedFocus).toEqual([]);
    expect(dialog.contains(document.activeElement)).toBe(true);
  } finally {
    document.removeEventListener('focusin', recordFocus, true);
  }

  await user.tab({ shift: true });
  expect(within(dialog).getByRole('button', { name: 'Save changes' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  expect(screen.getByRole('textbox', { name: 'First option' })).toHaveValue('one draft');
});

it('guards explicit repeated requests and refocuses after accepting Discard', async () => {
  const user = userEvent.setup();
  let send: (request: { target: string; requestId: number }) => void = () => {
    throw new Error('Request harness is not mounted'); 
  };

  const target = '/settings?category=general&setting=general.first';
  function Harness() {
    const [request, setRequest] = React.useState({ target, requestId: 1 });
    send = setRequest;
    return <SettingsPage request={request} />;
  }

  const registry = new ExtensionPointRegistry();
  const router = createMemoryRouter([{ path: '/settings', element: <Harness /> }], { initialEntries: [target] });
  render(<ExtensionProvider registry={registry}><RouterProvider router={router} /></ExtensionProvider>);
  await expectFocusedSetting('First option', 'general.first');
  await user.type(screen.getByRole('textbox', { name: 'First option' }), ' changed');
  act(() => {
    send({ target, requestId: 2 }); 
  });
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
  await expectFocusedSetting('First option', 'general.first');
  expect(screen.getByRole('textbox', { name: 'First option' })).toHaveValue('one');
});

it('focuses an editor that arrives after its requested row mounts', async () => {
  const view = (ready: boolean) => <SettingsFocusContext.Provider value={{ settingId: 'general.first', requestKey: 'async' }}>
    <SettingsEntries section={Section.Core} id='general' settings={categories.general.settings}
      draftValues={{}} setDraftValues={vi.fn()}
      renderSetting={{ 'general.first': () => ready ? <input aria-label='Delayed editor' /> : <span>Loading editor…</span> }} />
  </SettingsFocusContext.Provider>;
  const rendered = render(view(false));
  expect(screen.getByText('Loading editor…').closest('[data-setting-id]')).toHaveFocus();
  rendered.rerender(view(true));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Delayed editor' })).toHaveFocus());
});

it('acknowledges a cancelled request without losing the draft or blocking later location updates', async () => {
  const user = userEvent.setup();
  const locationChanged = vi.fn();
  let send: (request: { target: string; requestId: number }) => void = () => {
    throw new Error('Request harness is not mounted'); 
  };

  function Harness() {
    const [request, setRequest] = React.useState({ target: '/settings?category=general', requestId: 1 });
    send = setRequest;
    return <SettingsPage request={request} onLocationChange={locationChanged} />;
  }

  const registry = new ExtensionPointRegistry();
  const router = createMemoryRouter([{ path: '/settings', element: <Harness /> }], { initialEntries: ['/settings?category=general'] });
  render(<ExtensionProvider registry={registry}><RouterProvider router={router} /></ExtensionProvider>);
  await user.type(screen.getByRole('textbox', { name: 'First option' }), ' draft');
  act(() => {
    send({ target: '/settings?category=appearance', requestId: 2 }); 
  });
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('textbox', { name: 'First option' })).toHaveValue('one draft');
  expect(locationChanged).toHaveBeenLastCalledWith('/settings?category=general', 2);
  await user.click(screen.getByRole('option', { name: 'Appearance' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
  await waitFor(() => {
    expect(locationChanged).toHaveBeenLastCalledWith('/settings?section=core&category=appearance', 2); 
  });
});

it('accepts the newest target when another request arrives during a guarded save', async () => {
  const user = userEvent.setup();
  const saving = Promise.withResolvers<{ applied: boolean; uncertain: boolean; message: string }>();
  mocks.setSettings.mockReturnValueOnce(saving.promise);
  const locationChanged = vi.fn();
  let send: (request: { target: string; requestId: number }) => void = () => {
    throw new Error('Request harness is not mounted'); 
  };

  function Harness() {
    const [request, setRequest] = React.useState({ target: '/settings?category=general', requestId: 1 });
    send = setRequest;
    return <SettingsPage request={request} onLocationChange={locationChanged} />;
  }

  const registry = new ExtensionPointRegistry();
  const router = createMemoryRouter([{ path: '/settings', element: <Harness /> }], { initialEntries: ['/settings?category=general'] });
  render(<ExtensionProvider registry={registry}><RouterProvider router={router} /></ExtensionProvider>);
  await user.type(screen.getByRole('textbox', { name: 'First option' }), ' draft');
  act(() => {
    send({ target: '/settings?category=appearance', requestId: 2 }); 
  });
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => {
    expect(mocks.setSettings).toHaveBeenCalled(); 
  });
  act(() => {
    send({ target: '/settings?category=developer', requestId: 3 }); 
  });
  await act(async () => {
    saving.resolve({ applied: true, uncertain: false, message: '' }); 
  });
  expect(await screen.findByRole('group', { name: 'Profiling port' })).toBeVisible();
  expect(locationChanged).toHaveBeenLastCalledWith('/settings?category=developer', 3);
});

it('keeps event-supplied settings mounted when the older initial read fails', async () => {
  const initial = Promise.withResolvers<NativeSettingsState>();
  mocks.getWindowState.mockReturnValue(initial.promise);
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    renderSettingsWindow();
    act(() => mocks.stateListener?.({ data: { requestId: 8, target: '/settings?category=developer', visible: true } }));
    const editor = await screen.findByRole('spinbutton', { name: 'Profiling port' });
    await act(async () => {
      initial.reject(new Error('initial read failed')); 
    });
    expect(editor).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Profiling port' })).toBe(editor);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally {
    log.mockRestore();
  }
});

it.each(['resolve', 'reject'] as const)('retains the latest navigation after an older location write %ss', async outcome => {
  const user = userEvent.setup();
  const first = Promise.withResolvers<void>();
  let saved: NativeSettingsState = { requestId: 7, target: '/settings?category=general', visible: true };
  let firstWrite = true;
  mocks.getWindowState.mockImplementation(async () => saved);
  mocks.setWindowLocation.mockImplementation(async (target: string, requestId: number) => {
    const commit = () => {
      if (requestId === saved.requestId) {
        saved = { ...saved, target };
      }
    };

    if (firstWrite) {
      firstWrite = false;
      return first.promise.then(commit);
    }

    commit();
    return Promise.resolve();
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = renderSettingsWindow();
    await screen.findByRole('textbox', { name: 'First option' });
    await user.click(screen.getByRole('option', { name: 'Appearance' }));
    await user.click(screen.getByRole('option', { name: /Developer/ }));
    await screen.findByRole('spinbutton', { name: 'Profiling port' });
    await act(async () => {
      if (outcome === 'resolve') {
        first.resolve();
      } else {
        first.reject(new Error('first location write failed'));
      }
    });
    await waitFor(() => {
      expect(saved.target).toContain('category=developer'); 
    });
    view.unmount();
    renderSettingsWindow();
    expect(await screen.findByRole('spinbutton', { name: 'Profiling port' })).toBeVisible();
  } finally {
    log.mockRestore();
  }
});

it('retains later sidebar navigation after a targeted URL contains a fragment', async () => {
  const user = userEvent.setup();
  let saved: NativeSettingsState = { requestId: 7, target: '/settings?category=general#section', visible: true };
  mocks.getWindowState.mockImplementation(async () => saved);
  mocks.setWindowLocation.mockImplementation(async (target: string) => {
    saved = { ...saved, target };
  });
  const view = renderSettingsWindow();
  await screen.findByRole('textbox', { name: 'First option' });
  await user.click(screen.getByRole('option', { name: 'Appearance' }));
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  view.unmount();
  renderSettingsWindow();
  expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeVisible();
});
