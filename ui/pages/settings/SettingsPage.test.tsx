import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ExtensionPointRegistry, ExtensionProvider } from '@omniviewdev/runtime';
import { Category, Setting, SettingType } from '@omniviewdev/runtime/models';
import type * as RuntimeCore from '@omniviewdev/runtime';
import type * as AppThemeController from '@/theme/AppThemeController';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setSettings: vi.fn(), selectTheme: vi.fn(), reload: vi.fn() }));
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
};
const plugin = { id: 'probe', metadata: { name: 'Native probe', description: 'Private native plugin', icon: 'LuSettings' } };

vi.mock('@/hooks/settings/useCoreSettings', () => ({
  useSettingsProvider: () => ({ settings: { data: categories, isLoading: false, isError: false } }),
}));
vi.mock('@/hooks/settings/useCategorySettings', () => ({
  useCategorySettings: ({ category }: { category: keyof typeof categories }) => ({
    settings: { data: categories[category], isLoading: false, isError: false }, setSettings: mocks.setSettings,
  }),
}));
vi.mock('@/hooks/settings/usePluginSettings', () => ({
  usePluginSettings: () => ({
    settings: { data: { endpoint: new Setting({ id: 'endpoint', label: 'Endpoint', type: SettingType.Text, value: 'native' }) }, isLoading: false, isError: false },
    setSettings: mocks.setSettings,
  }),
}));
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
  return { ...actual, useSettings: () => ({ reload: mocks.reload }) };
});

import SettingsPage from './index';

function renderSettings(initial = '/settings?category=general') {
  const registry = new ExtensionPointRegistry();
  registry.addExtensionPoint({ id: 'probe/settings-proof', pluginId: 'probe', mode: 'multiple' });
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: [initial] });
  const view = render(<ExtensionProvider registry={registry}><RouterProvider router={router} /></ExtensionProvider>);
  return { router, registry, ...view };
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
  mocks.setSettings.mockReset().mockResolvedValue(undefined);
  mocks.selectTheme.mockReset().mockResolvedValue(undefined);
  mocks.reload.mockReset();
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
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeVisible();
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

  it('selects actual plugin settings from the explicit section/plugin query and focuses only its setting', async () => {
    renderSettings('/settings?section=plugins&plugin=probe&setting=probe.endpoint');
    expect(screen.getByText('Endpoint')).toBeVisible();
    await expectFocusedSetting('Endpoint', 'probe.endpoint');
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
});

it('refocuses the actual Theme editor when navigation requests the same already-mounted settings URL again', async () => {
  const target = '/settings?category=appearance&setting=appearance.theme';
  const { router } = renderSettings(target);
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveFocus(); 
  });
  const editor = screen.getByRole('combobox', { name: 'Theme' });
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
