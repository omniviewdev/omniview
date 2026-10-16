import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { themeRegistry } from '@omniviewdev/base-ui';
import type * as AppThemeControllerModule from '@/theme/AppThemeController';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  selectTheme: vi.fn(),
  setSettings: vi.fn(),
  requestedThemeId: 'dark',
}));

vi.mock('@/theme/AppThemeController', async (importOriginal) => {
  const actual = await importOriginal<typeof AppThemeControllerModule>();
  return {
    ...actual,
    useAppTheme: () => ({
      requestedThemeId: mocks.requestedThemeId,
      activeTheme: themeRegistry.get('dark'),
      isFallback: false,
      selectTheme: mocks.selectTheme,
    }),
  };
});

vi.mock('@/hooks/settings/useCategorySettings', () => ({
  useCategorySettings: () => ({
    settings: {
      data: {
        id: 'appearance',
        label: 'Appearance',
        description: 'Customize Omniview',
        icon: 'LuPaintbrush',
        settings: {
          theme: new Setting({
            id: 'theme',
            label: 'Theme',
            description: 'Application color theme',
            type: SettingType.Select,
            value: 'dark',
            default: 'dark',
            options: [],
          }),
          headerSearch: new Setting({
            id: 'headerSearch',
            label: 'Header Search Label',
            description: 'Header search placeholder',
            type: SettingType.Text,
            value: 'Search',
            default: 'Search',
            options: [],
          }),
        },
      },
      isLoading: false,
      isError: false,
    },
    setSettings: mocks.setSettings,
  }),
}));

vi.mock('@omniviewdev/runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSettings: () => ({ reload: mocks.reload }),
  };
});

vi.mock('@/hooks/useDevMode', () => ({
  useDevMode: () => false,
}));

import CoreSettingsPage from './CoreSettingsPage';

describe('CoreSettingsPage appearance settings', () => {
  beforeEach(() => {
    mocks.reload.mockReset();
    mocks.selectTheme.mockReset().mockResolvedValue(undefined);
    mocks.setSettings.mockReset().mockResolvedValue(undefined);
    mocks.requestedThemeId = 'dark';
  });

  afterEach(cleanup);

  it('applies the theme outside draft state while ordinary settings still save normally', async () => {
    render(<CoreSettingsPage id='appearance' />);

    fireEvent.click(screen.getByRole('combobox'));
    const obsidian = within(screen.getByRole('listbox')).getByRole('option', { name: 'Obsidian' });
    fireEvent.mouseMove(obsidian);
    fireEvent.click(obsidian);

    expect(mocks.selectTheme).toHaveBeenCalledWith('obsidian');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Find' } });
    expect(screen.getByText('Unsaved change')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });

    expect(mocks.setSettings).toHaveBeenCalledWith({ 'appearance.headerSearch': 'Find' });
    expect(mocks.setSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      'appearance.theme': expect.anything(),
    }));
    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
  });

  it('marks an empty draft value and clears its marker when discarded', () => {
    render(<CoreSettingsPage id='appearance' />);

    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(screen.getByText('Unsaved change')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Search');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  });
});
