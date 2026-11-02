import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applications: vi.fn(),
  supported: vi.fn(),
  commit: vi.fn(),
  validate: vi.fn(),
  saved: 'terminal',
}));

vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/exec/servicewrapper', () => ({
  GetNativeTerminalApplications: mocks.applications,
  GetNativeTerminalSupport: mocks.supported,
}));
vi.mock('@/theme/AppearanceThemeSetting', () => ({ default: () => null }));
vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
vi.mock('@omniviewdev/runtime', () => ({
  useScopedSettings: () => ({
    categories: { terminal: {
      id: 'terminal',
      label: 'Terminal',
      description: 'Customize the behavior of the terminal',
      settings: {
        nativeApplication: new Setting({
          id: 'nativeApplication',
          label: 'Native Terminal Application',
          description: 'macOS application for a fresh external resource shell.',
          type: SettingType.Text,
          value: mocks.saved,
          default: 'terminal',
          options: [],
        }),
      },
    } },
    isLoading: false,
    error: null,
    validate: mocks.validate,
    commit: mocks.commit,
  }),
}));

import CoreSettingsPage from './CoreSettingsPage';

const applications = [
  { id: 'terminal', name: 'Device Terminal', bundleID: 'com.apple.Terminal', path: '/System/Applications/Utilities/Terminal.app', iconDataURL: 'data:image/png;base64,dGVybWluYWw=' },
  { id: 'iterm2', name: 'Device iTerm', bundleID: 'com.googlecode.iterm2', path: '/Applications/iTerm.app', iconDataURL: 'data:image/png;base64,aXRlcm0=' },
];

const picker = () => screen.getByRole('combobox', { name: 'Native Terminal Application' });

async function chooseApplication(name: string) {
  fireEvent.click(picker());
  const option = await screen.findByRole('option', { name });
  fireEvent.mouseMove(option);
  await act(async () => {
    fireEvent.click(option);
  });
}

describe('native terminal application setting', () => {
  beforeEach(() => {
    mocks.saved = 'terminal';
    mocks.supported.mockReset().mockResolvedValue(true);
    mocks.applications.mockReset().mockResolvedValue(applications);
    mocks.validate.mockReset().mockResolvedValue({ valid: true, code: 'valid', message: 'Installed application.' });
    mocks.commit.mockReset().mockImplementation(async (values: Record<string, string>) => {
      mocks.saved = values['terminal.nativeApplication'];
      return { applied: true, uncertain: false, message: '' };
    });
  });

  afterEach(cleanup);

  it('disables the picker until discovery resolves without falling back to a text input', async () => {
    const pending = Promise.withResolvers<typeof applications>();
    mocks.applications.mockReturnValue(pending.promise);
    render(<CoreSettingsPage id='terminal' />);

    expect(picker()).toBeDisabled();
    expect(screen.getByText('Looking for installed supported applications…')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve(applications);
    });

    expect(picker()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  });

  it('changes only the draft until Save Changes commits the stable ID', async () => {
    render(<CoreSettingsPage id='terminal' />);
    await screen.findByText('Discovered on this Mac');
    await chooseApplication('Device iTerm');

    expect(picker()).toHaveTextContent('Device iTerm');
    expect(screen.getByText('Unsaved change')).toBeVisible();
    expect(mocks.commit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });

    expect(mocks.commit).toHaveBeenCalledWith({ 'terminal.nativeApplication': 'iterm2' });
    expect(picker()).toHaveTextContent('Device iTerm');
    expect(screen.queryByText('Unsaved change')).not.toBeInTheDocument();
  });

  it('discards a chosen application without saving', async () => {
    render(<CoreSettingsPage id='terminal' />);
    await screen.findByText('Discovered on this Mac');
    await chooseApplication('Device iTerm');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(picker()).toHaveTextContent('Device Terminal');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  });

  it('keeps a missing persisted selection visible without choosing a fallback', async () => {
    mocks.saved = 'iterm2';
    mocks.applications.mockResolvedValue([applications[0]]);
    render(<CoreSettingsPage id='terminal' />);

    expect(await screen.findByText(/Selected application \(iterm2\) is no longer available/)).toBeVisible();
    expect(picker()).toHaveTextContent('Unavailable application (iterm2)');
    expect(picker().querySelector('img')).toBeNull();
    fireEvent.click(picker());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option', { name: 'Device Terminal' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('supports keyboard selection through the accessible picker', async () => {
    const user = userEvent.setup();
    render(<CoreSettingsPage id='terminal' />);
    await screen.findByText('Discovered on this Mac');
    picker().focus();
    await user.keyboard('[Space]');
    await screen.findByRole('listbox');
    await user.keyboard('[End][Enter]');

    expect(picker()).toHaveTextContent('Device iTerm');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('shows discovery errors and retries without changing the saved selection', async () => {
    mocks.saved = 'iterm2';
    mocks.applications.mockRejectedValueOnce(new Error('Application metadata could not be read.'));
    render(<CoreSettingsPage id='terminal' />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Application metadata could not be read.');
    expect(picker()).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' }));
    await screen.findByText('Discovered on this Mac');

    expect(picker()).toHaveTextContent('Device iTerm');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  });

  it('shows an empty installed list and allows a rescan without a text fallback', async () => {
    mocks.applications.mockResolvedValueOnce([]);
    render(<CoreSettingsPage id='terminal' />);

    expect(await screen.findByText(/No supported terminal applications were found/)).toBeVisible();
    expect(picker()).toBeDisabled();
    expect(picker()).toHaveTextContent('Unavailable application (terminal)');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh applications' }));
    await screen.findByText('Discovered on this Mac');
    expect(picker()).toHaveTextContent('Device Terminal');
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('refreshes installed alternatives without overwriting an unsaved selection', async () => {
    render(<CoreSettingsPage id='terminal' />);
    await screen.findByText('Discovered on this Mac');
    await chooseApplication('Device iTerm');
    mocks.applications.mockResolvedValue([applications[0]]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh applications' }));
    expect(await screen.findByText(/Selected application \(iterm2\) is no longer available/)).toBeVisible();
    expect(picker()).toHaveTextContent('Unavailable application (iterm2)');
    expect(screen.getByText('Unsaved change')).toBeVisible();
    expect(mocks.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(picker()).toHaveTextContent('Device Terminal');
  });

  it('disables discovery outside macOS and preserves the preference', async () => {
    mocks.supported.mockResolvedValue(false);
    render(<CoreSettingsPage id='terminal' />);

    expect(await screen.findByText(/Native terminal applications are available only on macOS/)).toBeVisible();
    expect(picker()).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.applications).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
