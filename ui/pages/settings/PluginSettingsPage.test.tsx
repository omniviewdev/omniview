import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Setting, SettingType } from '@omniviewdev/runtime/models';

const mocks = vi.hoisted(() => ({ validate: vi.fn(), save: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ SettingsClient: { ValidateSetting: mocks.validate } }));
vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
vi.mock('@/hooks/plugin/usePluginManager', () => ({
  usePlugin: () => ({ plugin: { data: { metadata: { name: 'Fixture', description: 'Plugin settings', icon: '' } } } }),
}));
vi.mock('@/hooks/settings/usePluginSettings', () => ({
  usePluginSettings: () => ({
    settings: { data: { 'tool.path': new Setting({ id: 'tool.path', label: 'Tool', type: SettingType.Text, value: 'saved', default: '', options: [] }) } },
    setSettings: mocks.save,
  }),
}));

import PluginSettingsPage from './PluginSettingsPage';

describe('plugin settings validation', () => {
  beforeEach(() => {
    mocks.validate.mockReset().mockResolvedValue({ valid: true, code: 'ready', message: 'Tool ready.' });
    mocks.save.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('validates through the plugin and preserves dotted setting IDs when saving', async () => {
    render(<PluginSettingsPage id='fixture.plugin' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'good' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });
    expect(mocks.validate).toHaveBeenCalledWith('fixture.plugin', 'tool.path', 'good');
    expect(mocks.save).toHaveBeenCalledWith({ 'tool.path': 'good' });
    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
  });

  it('shows contextual failure without saving or dropping the draft', async () => {
    mocks.validate.mockResolvedValue({ valid: false, code: 'failed', message: 'Select a working tool.' });
    render(<PluginSettingsPage id='fixture' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bad' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText('Select a working tool.')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('bad');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('ignores responses after switching plugins', async () => {
    vi.useFakeTimers();
    try {
      const { promise, resolve } = Promise.withResolvers<{ valid: boolean; code: string; message: string }>();
      mocks.validate.mockReturnValue(promise);
      const view = render(<PluginSettingsPage id='first' />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'old' } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      view.rerender(<PluginSettingsPage id='second' />);
      await act(async () => {
        resolve({ valid: false, code: 'old', message: 'Old plugin failure' });
      });
      expect(screen.queryByText('Old plugin failure')).not.toBeInTheDocument();
      expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
