import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { themeRegistry } from '@omniviewdev/base-ui';
import type * as AppThemeControllerModule from '@/theme/AppThemeController';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectTheme: vi.fn(),
  setSettings: vi.fn(),
  validateSetting: vi.fn(),
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

vi.mock('@omniviewdev/runtime', () => ({
  useScopedSettings: () => ({
    categories: { appearance: {
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
        density: new Setting({
          id: 'density', label: 'UI Density', type: SettingType.Text,
          value: 'comfortable', default: 'comfortable',
          options: [{ value: 'comfortable', label: 'Comfortable', description: '' }, { value: 'compact', label: 'Compact', description: '' }],
        }),
        textSize: new Setting({
          id: 'textSize', label: 'UI Text Size', type: SettingType.Text,
          value: '100', default: '100',
          options: [{ value: '80', label: '80%', description: '' }, { value: '90', label: '90%', description: '' }, { value: '100', label: '100%', description: '' }, { value: '110', label: '110%', description: '' }, { value: '125', label: '125%', description: '' }],
        }),
        motion: new Setting({
          id: 'motion', label: 'Motion', type: SettingType.Text,
          value: 'system', default: 'system',
          options: [{ value: 'system', label: 'Follow System', description: '' }, { value: 'normal', label: 'Normal', description: '' }, { value: 'reduced', label: 'Reduced', description: '' }],
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
    } },
    isLoading: false,
    error: null,
    commit: mocks.setSettings,
    validate: mocks.validateSetting,
  }),
}));

vi.mock('@/hooks/useDevMode', () => ({
  useDevMode: () => false,
}));

import CoreSettingsPage from './CoreSettingsPage';

describe('CoreSettingsPage appearance settings', () => {
  beforeEach(() => {
    mocks.selectTheme.mockReset().mockResolvedValue(undefined);
    mocks.setSettings.mockReset().mockResolvedValue({ applied: true, uncertain: false, message: '' });
    mocks.validateSetting.mockReset().mockResolvedValue({ valid: true, code: 'valid', message: 'Value is valid.' });
    mocks.requestedThemeId = 'dark';
  });

  afterEach(cleanup);

  it('applies the theme outside draft state while ordinary settings still save normally', async () => {
    render(<CoreSettingsPage id='appearance' />);

    fireEvent.click(screen.getByRole('radio', { name: 'Obsidian' }));

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

  it.each(['80', '90', '125'])('saves %s percent text through ordinary validated settings commits', async textSize => {
    const user = userEvent.setup();
    render(<CoreSettingsPage id='appearance' />);
    await user.click(screen.getByRole('combobox', { name: 'UI Density' }));
    await user.click(await screen.findByRole('option', { name: 'Compact' }));
    await user.click(screen.getByRole('combobox', { name: 'UI Text Size' }));
    await user.click(await screen.findByRole('option', { name: `${textSize}%` }));
    await user.click(screen.getByRole('combobox', { name: 'Motion' }));
    await user.click(await screen.findByRole('option', { name: 'Reduced' }));
    expect(mocks.setSettings).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });
    expect(mocks.setSettings).toHaveBeenCalledWith({
      'appearance.density': 'compact',
      'appearance.textSize': textSize,
      'appearance.motion': 'reduced',
    });
    expect(mocks.selectTheme).not.toHaveBeenCalled();
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

  it('retains invalid drafts and prevents saves with contextual feedback', async () => {
    mocks.validateSetting.mockResolvedValue({ valid: false, code: 'invalid', message: 'Select a working executable.' });
    render(<CoreSettingsPage id='appearance' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'broken' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });
    expect(mocks.setSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Select a working executable.')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('broken');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('ignores validation responses after discard', async () => {
    vi.useFakeTimers();
    try {
      const { promise, resolve } = Promise.withResolvers<{ valid: boolean; code: string; message: string }>();
      mocks.validateSetting.mockReturnValue(promise);
      render(<CoreSettingsPage id='appearance' />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      await act(async () => {
        resolve({ valid: false, code: 'stale', message: 'Old failure' });
      });
      expect(screen.queryByText('Old failure')).not.toBeInTheDocument();
      expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
