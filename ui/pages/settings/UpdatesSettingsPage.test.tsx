import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), commit: vi.fn(), showFeatures: false, current: 'stable' }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: mocks.call } }));
vi.mock('@omniviewdev/runtime', () => ({
  HOST_SETTINGS_SCOPE: { kind: 'host' },
  useScopedSettings: () => ({ commit: mocks.commit }),
  useSettings: () => ({ settings: { 'developer.show_feature_channels': mocks.showFeatures } }),
}));
vi.mock('@omniviewdev/base-ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  Checkbox: ({ children, checked, onCheckedChange }: { children: React.ReactNode; checked: boolean; onCheckedChange: (value: boolean) => void }) =>
    <label><input type='checkbox' checked={checked} onChange={event => {
      onCheckedChange(event.target.checked);
    }} />{children}</label>,
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) =>
    <input type='checkbox' checked={checked} onChange={event => {
      onCheckedChange(event.target.checked);
    }} />,
  Select: {
    Root: ({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void; disabled: boolean }) =>
      <select aria-label='Release channel' value={value} disabled={disabled} onChange={event => {
        onValueChange(event.target.value);
      }}>{children}</select>,
    Trigger: () => null, Value: () => null, Icon: () => null,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Positioner: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Popup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    List: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Item: ({ children, value, disabled }: { children: React.ReactNode; value: string; disabled: boolean }) => <option value={value} disabled={disabled}>{children}</option>,
    ItemText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));
import UpdatesSettingsPage from './UpdatesSettingsPage';

const options = [
  { channel: 'stable', status: 'active', desktopVersion: '1.0.0', stateExists: true, statePath: '/home/user/.omniview' },
  { channel: 'nightly', status: 'active', desktopVersion: '0.9.0', stateExists: false, statePath: '/home/user/.omniview-nightly' },
  { channel: 'feature-abc', status: 'active', desktopVersion: '1.1.0-feature-abc.1.1', stateExists: false, statePath: '/home/user/.omniview-feature-abc' },
  { channel: 'feature-empty', status: 'active', desktopVersion: '', stateExists: false, statePath: '/home/user/.omniview-feature-empty' },
  { channel: 'feature-old', status: 'archived', desktopVersion: '1.0.0', stateExists: true, statePath: '/home/user/.omniview-feature-old' },
];

describe('UpdatesSettingsPage channels', () => {
  beforeEach(() => {
    mocks.showFeatures = false;
    mocks.current = 'stable';
    mocks.commit.mockReset().mockResolvedValue({ applied: true, uncertain: false });
    mocks.call.mockReset().mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) {
        return { state: 'idle', channel: mocks.current };
      }

      if (method.endsWith('.ListChannels')) {
        return { current: mocks.current, options, error: '' };
      }

      return undefined;
    });
  });
  afterEach(cleanup);

  it('retries failed channel index discovery and restores feature channels', async () => {
    mocks.showFeatures = true;
    let attempts = 0;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) {
        return { state: 'idle', channel: 'stable' };
      }

      if (method.endsWith('.ListChannels')) {
        attempts += 1;
        return attempts === 1
          ? { current: 'stable', options: options.slice(0, 2), error: 'load channel index: offline' }
          : { current: 'stable', options, error: '' };
      }

      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('load channel index: offline');
    expect(screen.queryByRole('option', { name: 'feature-abc' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry channel discovery' }));
    expect(await screen.findByRole('option', { name: 'feature-abc' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(attempts).toBe(2);
  });

  it('retries a rejected channel list request', async () => {
    let attempts = 0;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) {
        return { state: 'idle', channel: 'stable' };
      }

      if (method.endsWith('.ListChannels')) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('offline');
        }

        return { current: 'stable', options, error: '' };
      }

      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry channel discovery' }));
    expect(await screen.findByRole('option', { name: 'Nightly' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('filters feature and archived channels and commits visibility setting', async () => {
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Nightly' });
    expect(screen.queryByRole('option', { name: 'feature-abc' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show feature channels'));
    await waitFor(() => {
      expect(mocks.commit).toHaveBeenCalledWith({ 'developer.show_feature_channels': true });
    });
  });

  it('displays active features and disables channels without builds', async () => {
    mocks.showFeatures = true;
    render(<UpdatesSettingsPage />);
    expect(await screen.findByRole('option', { name: 'feature-abc' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'feature-empty (no desktop build yet)' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'feature-old' })).not.toBeInTheDocument();
  });

  it('shows copy only for new state and passes switch arguments', async () => {
    mocks.showFeatures = true;
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'feature-abc' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'feature-abc' } });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'feature-abc', true);
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
  });

  it('preserves deselection until the target changes', async () => {
    mocks.showFeatures = true;
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'feature-abc' });
    const select = screen.getByRole('combobox', { name: 'Release channel' });
    fireEvent.change(select, { target: { value: 'feature-abc' } });
    fireEvent.click(screen.getByLabelText('Copy my current data to this channel'));
    expect(screen.getByLabelText('Copy my current data to this channel')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'feature-abc', false);
    });
    expect(screen.getByLabelText('Copy my current data to this channel')).not.toBeChecked();
    fireEvent.change(select, { target: { value: 'nightly' } });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
    fireEvent.change(select, { target: { value: 'feature-abc' } });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
  });

  it('does not copy to an existing target', async () => {
    mocks.current = 'nightly';
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Stable' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'stable', false);
    });
  });

  it('does not copy when refreshed discovery finds existing target data', async () => {
    mocks.showFeatures = true;
    let attempts = 0;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) {
        return { state: 'idle', channel: 'stable' };
      }

      if (method.endsWith('.ListChannels')) {
        attempts += 1;
        return {
          current: 'stable',
          options: options.map(option => option.channel === 'feature-abc'
            ? { ...option, stateExists: attempts > 1 }
            : option),
          error: attempts === 1 ? 'load channel index: offline' : '',
        };
      }

      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'feature-abc' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'feature-abc' } });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Retry channel discovery' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'feature-abc', false);
    });
  });

  it('shows retired current channel even when feature channels are hidden', async () => {
    mocks.current = 'feature-old';
    render(<UpdatesSettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This channel was retired. Switch to Stable to keep receiving updates.');
    expect(screen.getByRole('option', { name: 'feature-old' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
  });
  it('shows the selected channel data path, existence, and retention guidance', async () => {
    mocks.current = 'nightly';
    render(<UpdatesSettingsPage />);
    await screen.findByText('Data path: /home/user/.omniview-nightly');
    expect(screen.getByText('Channel data: Not found')).toBeInTheDocument();
    expect(screen.getByText('Existing channel data is retained. Copying current data is available only for a new channel profile.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.getByText('Data path: /home/user/.omniview')).toBeInTheDocument();
    expect(screen.getByText('Channel data: Exists')).toBeInTheDocument();
  });
  it('displays the backend current profile path', async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'stable' };
      if (method.endsWith('.ListChannels')) return {
        current: 'stable',
        options: options.map(option => option.channel === 'stable' ? { ...option, statePath: '/custom/current' } : option),
        error: '',
      };
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect(await screen.findByText('Data path: /custom/current')).toBeInTheDocument();
  });

  it('shows profile directory modification and use status for current, inactive, and retired profiles', async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'stable' };
      if (method.endsWith('.ListChannels')) return {
        current: 'stable',
        options: options.map(option => ({
          ...option,
          stateModifiedAt: option.channel === 'stable' ? '2026-01-02T03:04:05Z' : '',
          stateFileModifiedAt: option.channel === 'stable'
            ? { 'settings.db': '2026-01-01T00:00:00Z', 'plugin_state.json': '2026-01-02T00:00:00Z' }
            : option.channel === 'feature-old' ? { 'switch-seed.json': '2026-01-03T00:00:00Z' } : {},
          stateInUse: option.channel === 'stable' ? 'in-use' : option.channel === 'nightly' ? 'not-in-use' : 'unknown',
        })),
        error: '',
      };
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect(await screen.findByText('Profile directory top-level entries modified: 2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.getByText('Profile in use: Yes')).toBeInTheDocument();
    expect(screen.getByText('Profile in use: Unknown')).toBeInTheDocument();
    expect(screen.getByText('settings.db: 2026-01-01T00:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('plugin_state.json: 2026-01-02T00:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('switch-seed.json: 2026-01-03T00:00:00Z')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'nightly' } });
    expect(screen.getByText('Profile in use: No')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Profile directory top-level entries modified: Unknown')).toHaveLength(2);
  });

  it('shows inspection errors and prevents deletion of affected profiles', async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'nightly' };
      if (method.endsWith('.ListChannels')) return {
        current: 'nightly',
        options: options.map(option => ['stable', 'feature-old'].includes(option.channel)
          ? { ...option, stateExists: false, stateError: `cannot inspect ${option.channel}` }
          : option),
        error: '',
      };
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect(await screen.findByText('Profile inspection failed: cannot inspect feature-old')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete data for feature-old' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.getByText('Profile inspection failed: cannot inspect stable')).toBeInTheDocument();
    expect(screen.getByText('Channel data: Unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete channel data' })).toBeDisabled();
  });

  it('does not offer copy when target inspection fails', async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'stable' };
      if (method.endsWith('.ListChannels')) return {
        current: 'stable',
        options: options.map(option => option.channel === 'nightly'
          ? { ...option, stateError: 'permission denied' }
          : option),
        error: '',
      };
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Nightly' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'nightly' } });
    expect(screen.getByText('Profile inspection failed: permission denied')).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download and switch' })).toBeDisabled();
    expect(mocks.call).not.toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'nightly', false);
  });

  it('disables deletion of in-use and pending profiles', async () => {
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'nightly', switchTarget: 'feature-old' };
      if (method.endsWith('.ListChannels')) return {
        current: 'nightly',
        options: options.map(option => option.channel === 'stable' ? { ...option, stateInUse: 'in-use' } : option),
        error: '',
      };
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    expect(await screen.findByRole('button', { name: 'Delete data for feature-old' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.getByText('Profile in use: Yes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete channel data' })).toBeDisabled();
  });

  it('disables an open deletion confirmation if the profile becomes in use', async () => {
    let attempts = 0;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'nightly' };
      if (method.endsWith('.ListChannels')) {
        attempts += 1;
        return {
          current: 'nightly',
          options: options.map(option => option.channel === 'stable'
            ? { ...option, stateInUse: attempts > 1 ? 'in-use' : 'not-in-use' }
            : option),
          error: attempts === 1 ? 'load channel index: offline' : '',
        };
      }
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Stable' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete channel data' }));
    fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'stable' } });
    expect(screen.getByRole('button', { name: 'Permanently delete channel data' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry channel discovery' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Permanently delete channel data' })).toBeDisabled();
    });
  });

  it('refreshes profile discovery after switching with copy', async () => {
    let switched = false;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: switched ? 'ready' : 'idle', channel: 'stable', switchTarget: switched ? 'nightly' : '' };
      if (method.endsWith('.ListChannels')) return {
        current: 'stable',
        options: options.map(option => option.channel === 'nightly'
          ? { ...option, stateExists: switched, stateModifiedAt: switched ? 'new timestamp' : '' }
          : option),
        error: '',
      };
      if (method.endsWith('.SwitchChannel')) switched = true;
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Nightly' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'nightly' } });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(screen.getByText('Channel data: Exists')).toBeInTheDocument();
      expect(screen.getByText('Profile directory top-level entries modified: new timestamp')).toBeInTheDocument();
      expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
    });
    expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'nightly', true);
  });

  it('allows deleting retired profile data without offering it as a switch target', async () => {
    render(<UpdatesSettingsPage />);
    expect(await screen.findByText('Data path: /home/user/.omniview-feature-old')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'feature-old' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete data for feature-old' }));
    expect(screen.getByText('Permanently delete all files in /home/user/.omniview-feature-old. This cannot be undone.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type feature-old to confirm'), { target: { value: 'feature-old' } });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete channel data' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.DeleteChannelData', 'feature-old');
    });
  });

  it('requires exact confirmation and allows cancellation for an inactive profile', async () => {
    mocks.current = 'nightly';
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Stable' });
    expect(screen.queryByRole('button', { name: 'Delete channel data' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete channel data' }));
    expect(screen.getByText('Permanently delete all files in /home/user/.omniview. This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('Deletion can stop partway if a filesystem error occurs. Remaining files may be kept in a quarantine folder.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Permanently delete channel data' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'Stable' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'stable' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Permanently delete channel data' })).not.toBeInTheDocument();
    expect(mocks.call).not.toHaveBeenCalledWith('main.UpdateService.DeleteChannelData', 'stable');
  });

  it.each(['in-use', 'inspection-error', 'pending', 'request-error'])(
    'rechecks profile before deletion when status changes to %s',
    async scenario => {
      let lists = 0;
      let statuses = 0;
      mocks.call.mockImplementation(async (method: string) => {
        if (method.endsWith('.Status')) {
          statuses += 1;
          return { state: 'idle', channel: 'nightly', switchTarget: scenario === 'pending' && statuses > 1 ? 'stable' : '' };
        }
        if (method.endsWith('.ListChannels')) {
          lists += 1;
          if (scenario === 'request-error' && lists > 1) throw new Error('inspection unavailable');
          return {
            current: 'nightly',
            options: options.map(option => option.channel === 'stable' && lists > 1
              ? { ...option, stateInUse: scenario === 'in-use' ? 'in-use' : 'not-in-use', stateError: scenario === 'inspection-error' ? 'permission denied' : '' }
              : option),
            error: '',
          };
        }
        return undefined;
      });
      render(<UpdatesSettingsPage />);
      await screen.findByRole('option', { name: 'Stable' });
      fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete channel data' }));
      fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'stable' } });
      fireEvent.click(screen.getByRole('button', { name: 'Permanently delete channel data' }));
      await waitFor(() => {
        expect(screen.getByText(scenario === 'request-error' ? /inspection unavailable/ : /Profile status changed or could not be inspected/)).toBeInTheDocument();
      });
      expect(mocks.call).not.toHaveBeenCalledWith('main.UpdateService.DeleteChannelData', 'stable');
    },
  );

  it('disables actions while deleting and refreshes discovery after success', async () => {
    mocks.current = 'nightly';
    const deletion = Promise.withResolvers<void>();
    let deleted = false;
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'nightly' };
      if (method.endsWith('.ListChannels')) return {
        current: 'nightly',
        options: options.map(option => option.channel === 'stable' ? { ...option, stateExists: !deleted } : option),
        error: '',
      };
      if (method.endsWith('.DeleteChannelData')) {
        await deletion.promise;
        deleted = true;
      }
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Stable' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete channel data' }));
    fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete channel data' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.DeleteChannelData', 'stable');
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Permanently delete channel data' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download and switch' })).toBeDisabled();
    deletion.resolve();
    await waitFor(() => {
      expect(screen.getByText('Channel data: Not found')).toBeInTheDocument();
      expect(mocks.call.mock.calls.filter(([method]) => method.endsWith('.ListChannels'))).toHaveLength(3);
    });
    expect(screen.getByLabelText('Copy my current data to this channel')).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Delete channel data' })).not.toBeInTheDocument();
  });

  it('reports deletion errors and keeps confirmation available for retry', async () => {
    mocks.current = 'nightly';
    mocks.call.mockImplementation(async (method: string) => {
      if (method.endsWith('.Status')) return { state: 'idle', channel: 'nightly' };
      if (method.endsWith('.ListChannels')) return { current: 'nightly', options, error: '' };
      if (method.endsWith('.DeleteChannelData')) throw new Error('deletion incomplete; remaining files: C:\\Users\\user\\quarantine');
      return undefined;
    });
    render(<UpdatesSettingsPage />);
    await screen.findByRole('option', { name: 'Stable' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete channel data' }));
    fireEvent.change(screen.getByLabelText('Type stable to confirm'), { target: { value: 'stable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete channel data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Error: deletion incomplete; remaining files: C:\\Users\\user\\quarantine');
    expect(screen.getByRole('button', { name: 'Permanently delete channel data' })).toBeEnabled();
    expect(screen.getByText('Channel data: Exists')).toBeInTheDocument();
  });
});
