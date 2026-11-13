import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showFeatures: false,
  effective: 'stable',
  explicit: false,
  install: vi.fn(),
  versions: [] as Array<{ version: string; channel: string; compatible?: boolean }>,
}));
vi.mock('@omniviewdev/runtime', () => ({ useSettings: () => ({ settings: { 'developer.show_feature_channels': mocks.showFeatures } }) }));
vi.mock('@/hooks/plugin/usePluginManager', () => ({
  usePlugin: () => ({
    releaseState: { data: { effectiveChannel: mocks.effective, explicit: mocks.explicit, channels: [
      { channel: 'feature-abc', status: 'active' }, { channel: 'feature-old', status: 'archived' },
    ] } },
    channelVersions: { data: mocks.versions, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
    installFromChannel: mocks.install,
    operation: null,
  }),
}));
vi.mock('@omniviewdev/base-ui', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => <button onClick={onClick} disabled={disabled}>{children}</button>,
    Stack: Container,
    Text: ({ children, role }: React.PropsWithChildren<{ role?: string }>) => <span role={role}>{children}</span>,
    Dialog: Object.assign(({ children, open }: React.PropsWithChildren<{ open: boolean }>) => open ? <div role='dialog'>{children}</div> : null, { Title: Container, Body: Container, Footer: Container }),
    RadioGroup: Object.assign(({ children, onValueChange }: React.PropsWithChildren<{ onValueChange: (value: string) => void }>) => <div onChange={event => {
      onValueChange((event.target as HTMLInputElement).value);
    }}>{children}</div>, {
      Item: ({ children, value, disabled }: React.PropsWithChildren<{ value: string; disabled: boolean }>) => <label><input type='radio' name='version' value={value} disabled={disabled} />{children}</label>,
    }),
    Select: {
      Root: ({ children, value, onValueChange, disabled }: React.PropsWithChildren<{ value: string; onValueChange: (value: string) => void; disabled: boolean }>) => <select aria-label='Release channel' value={value} disabled={disabled} onChange={event => {
        onValueChange(event.target.value);
      }}>{children}</select>,
      Trigger: () => null, Value: () => null, Icon: () => null,
      Portal: Container, Positioner: Container, Popup: Container, List: Container,
      Item: ({ children, value, disabled }: React.PropsWithChildren<{ value: string; disabled?: boolean }>) => <option value={value} disabled={disabled}>{children}</option>,
      ItemText: Container,
    },
  };
});
import PluginUpdateButton from './PluginUpdateButton';

describe('plugin release channels', () => {
  beforeEach(() => {
    mocks.showFeatures = false;
    mocks.effective = 'stable';
    mocks.explicit = false;
    mocks.install.mockReset().mockResolvedValue({});
    mocks.versions = [
      { version: '2.0.0', channel: '' },
      { version: '1.1.0-feature-abc.1.1', channel: 'feature-abc' },
      { version: '3.0.0-feature-abc.1.1', channel: 'feature-abc', compatible: false },
    ];
  });
  afterEach(cleanup);

  it('shows active channels only when enabled', () => {
    const view = render(<PluginUpdateButton pluginID='example' />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    mocks.showFeatures = true;
    view.rerender(<PluginUpdateButton pluginID='example' />);
    expect(screen.getByRole('option', { name: 'Stable' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'feature-abc' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'feature-old' })).not.toBeInTheDocument();
  });

  it('recommends the compatible selected channel and installs it', async () => {
    mocks.showFeatures = true;
    render(<PluginUpdateButton pluginID='example' />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'feature-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install 1.1.0-feature-abc.1.1' }));
    await waitFor(() => {
      expect(mocks.install).toHaveBeenCalledWith({ channel: 'feature-abc', version: '1.1.0-feature-abc.1.1' });
    });
  });

  it('uses stable fallback and passes stable channel', async () => {
    mocks.showFeatures = true;
    mocks.versions = [{ version: '2.0.0', channel: '' }];
    render(<PluginUpdateButton pluginID='example' />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'feature-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install 2.0.0' }));
    await waitFor(() => {
      expect(mocks.install).toHaveBeenCalledWith({ channel: 'stable', version: '2.0.0' });
    });
  });

  it('confirms downgrades and reports retired explicit channels', async () => {
    mocks.effective = 'feature-old';
    mocks.explicit = true;
    mocks.versions = [{ version: '1.0.0', channel: '' }];
    render(<PluginUpdateButton pluginID='example' currentVersion='2.0.0' installed />);
    expect(screen.getByRole('alert')).toHaveTextContent('This plugin\'s release channel was retired.');
    fireEvent.click(screen.getByRole('button', { name: 'Update 1.0.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm downgrade' }));
    await waitFor(() => {
      expect(mocks.install).toHaveBeenCalledWith({ channel: 'stable', version: '1.0.0' });
    });
  });
});
