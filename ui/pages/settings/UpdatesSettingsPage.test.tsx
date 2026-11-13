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
  { channel: 'stable', status: 'active', desktopVersion: '1.0.0', stateExists: true },
  { channel: 'nightly', status: 'active', desktopVersion: '0.9.0', stateExists: false },
  { channel: 'feature-abc', status: 'active', desktopVersion: '1.1.0-feature-abc.1.1', stateExists: false },
  { channel: 'feature-empty', status: 'active', desktopVersion: '', stateExists: false },
  { channel: 'feature-old', status: 'archived', desktopVersion: '1.0.0', stateExists: true },
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
    fireEvent.click(screen.getByLabelText('Copy my current data to this channel'));
    fireEvent.click(screen.getByRole('button', { name: 'Download and switch' }));
    await waitFor(() => {
      expect(mocks.call).toHaveBeenCalledWith('main.UpdateService.SwitchChannel', 'feature-abc', true);
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
  });

  it('shows retired current channel even when feature channels are hidden', async () => {
    mocks.current = 'feature-old';
    render(<UpdatesSettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This channel was retired. Switch to Stable to keep receiving updates.');
    expect(screen.getByRole('option', { name: 'feature-old' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Release channel' }), { target: { value: 'stable' } });
    expect(screen.queryByLabelText('Copy my current data to this channel')).not.toBeInTheDocument();
  });
});
