import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmationModalContext } from '@omniviewdev/runtime';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import { SettingsFormRegistration, type SettingsNavigationForm } from '@/hooks/settings/useSettingsForm';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  listTools: vi.fn(),
  listPresets: vi.fn(),
  listConnectionPolicies: vi.fn(),
  setToolOverride: vi.fn(),
  setConnectionAccess: vi.fn(),
  applyPreset: vi.fn(),
  setEnabled: vi.fn(),
  confirmShow: vi.fn(),
  setPort: vi.fn(),
  saveUserPreset: vi.fn(),
  writeText: vi.fn(),
  listeners: new Map<string, (event: { data: unknown }) => void>(),
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  McpRelayClient: {
    GetStatus: mocks.getStatus,
    GetConfig: mocks.getConfig,
    ListTools: mocks.listTools,
    ListPresets: mocks.listPresets,
    ListConnectionPolicies: mocks.listConnectionPolicies,
    SetToolOverride: mocks.setToolOverride,
    SetConnectionAccess: mocks.setConnectionAccess,
    ApplyPreset: mocks.applyPreset,
    SetEnabled: mocks.setEnabled,
    SetPort: mocks.setPort,
    RotateToken: vi.fn(),
    SetBlockConnectionsByDefault: vi.fn(),
    SetPluginEnabled: vi.fn(),
    SaveUserPreset: mocks.saveUserPreset,
    DeleteUserPreset: vi.fn(),
  },
}));

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof WailsRuntime>();
  return {
    ...original,
    Events: { ...original.Events, On: (name: string, handler: (event: { data: unknown }) => void) => {
      mocks.listeners.set(name, handler);
      return () => mocks.listeners.delete(name);
    } },
  };
});

import AiToolsSettingsPage from './AiToolsSettingsPage';

const tool = (overrides: Record<string, unknown>) => ({
  mcpName: 'kubernetes_list_namespaces',
  pluginID: 'kubernetes',
  pluginName: 'Kubernetes',
  name: 'list_namespaces',
  title: '',
  description: 'List namespaces',
  scope: 'connection',
  status: 'ok',
  ready: true,
  listed: true,
  connectionID: 'prod',
  builtIn: false,
  readOnly: true,
  destructive: false,
  enabled: true,
  enabledSource: 'preset',
  confirm: false,
  confirmSource: 'default',
  overrideEnabled: null,
  overrideConfirm: null,
  ...overrides,
});

const connections = [
  {
    pluginID: 'kubernetes',
    pluginName: 'Kubernetes',
    connectionID: 'prod',
    connectionName: 'Production',
    access: '',
    effectiveAccess: true,
    preset: '',
    effectivePreset: 'read-only',
  },
];

function renderPage(registerForm: (form: SettingsNavigationForm | null) => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppSnackbarProvider>
        <ConfirmationModalContext.Provider value={{ show: mocks.confirmShow }}>
          <SettingsFormRegistration.Provider value={registerForm}>
            <AiToolsSettingsPage />
          </SettingsFormRegistration.Provider>
        </ConfirmationModalContext.Provider>
      </AppSnackbarProvider>
    </QueryClientProvider>,
  );
}

describe('AiToolsSettingsPage', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.getStatus.mockReset().mockResolvedValue({ enabled: true, running: true, endpoint: 'http://127.0.0.1:9590/mcp', error: '' });
    mocks.getConfig.mockReset().mockResolvedValue({
      enabled: true,
      port: 9590,
      endpoint: 'http://127.0.0.1:9590/mcp',
      token: 'secret-token',
      blockConnectionsByDefault: false,
      globalPreset: 'read-only',
      userPresets: [],
    });
    mocks.listTools.mockReset().mockResolvedValue([
      tool({}),
      tool({ mcpName: 'kubernetes_delete_resource', name: 'delete_resource', description: 'Delete', readOnly: false, destructive: true, enabled: false, confirm: true }),
      tool({ mcpName: 'alpha_ping', pluginID: 'alpha', pluginName: 'Alpha', name: 'ping', scope: 'plugin', description: 'Ping', enabled: false }),
    ]);
    mocks.listPresets.mockReset().mockResolvedValue([
      { name: 'all', builtIn: true, toolCount: 3 },
      { name: 'read-only', builtIn: true, toolCount: 1 },
      { name: 'none', builtIn: true, toolCount: 0 },
    ]);
    mocks.listConnectionPolicies.mockReset().mockResolvedValue(connections);
    mocks.setToolOverride.mockReset().mockResolvedValue(undefined);
    mocks.setConnectionAccess.mockReset().mockResolvedValue(undefined);
    mocks.applyPreset.mockReset().mockResolvedValue(undefined);
    mocks.setEnabled.mockReset().mockResolvedValue(undefined);
    mocks.setPort.mockReset().mockResolvedValue(undefined);
    mocks.saveUserPreset.mockReset().mockResolvedValue(undefined);
    mocks.confirmShow.mockReset();
    mocks.writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
  });

  afterEach(cleanup);

  it('saves drafts from the footer and discards later edits without writing them', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Kubernetes' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Port' }), { target: { value: '9690' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Save current selection as preset' }), { target: { value: 'Local' } });
    mocks.setPort.mockImplementation(async (port: number) => {
      mocks.getConfig.mockResolvedValue({ ...(await mocks.getConfig()), port });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument());
    expect(mocks.setPort).toHaveBeenCalledWith(9690);
    expect(mocks.saveUserPreset).toHaveBeenCalledWith('Local');
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(9690);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Port' }), { target: { value: '9790' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Save current selection as preset' }), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(9690);
    expect(screen.getByRole('textbox', { name: 'Save current selection as preset' })).toHaveValue('');
    expect(mocks.setPort).toHaveBeenCalledTimes(1);
    expect(mocks.saveUserPreset).toHaveBeenCalledTimes(1);
  });

  it('keeps only the failed preset draft guarded after a durable port save', async () => {
    let form: SettingsNavigationForm | null = null;
    renderPage(value => {
      form = value; 
    });
    await screen.findByRole('group', { name: 'Kubernetes' });
    mocks.setPort.mockImplementation(async (port: number) => {
      mocks.getConfig.mockResolvedValue({ ...(await mocks.getConfig()), port });
    });
    mocks.saveUserPreset.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Port' }), { target: { value: '9690' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Save current selection as preset' }), { target: { value: 'Keep me' } });
    let saved: boolean | undefined;
    await act(async () => {
      saved = await form!.save(); 
    });
    expect(saved).toBe(false);
    expect(form!.hasDrafts).toBe(true);
    const partialSaveError = screen.getByText(/port saved/i);
    expect(partialSaveError).toHaveAttribute('role', 'alert');
    expect(partialSaveError).toHaveTextContent(/preset.*could not be saved/i);
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(9690);
    expect(screen.getByRole('button', { name: 'Apply port' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Save current selection as preset' })).toHaveValue('Keep me');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument());
    expect(mocks.setPort).toHaveBeenCalledTimes(1);
    expect(mocks.saveUserPreset).toHaveBeenNthCalledWith(2, 'Keep me');
    expect(form!.hasDrafts).toBe(false);
    expect(screen.queryByText(/port saved/i)).not.toBeInTheDocument();
  });

  it('groups tools and edits the bound connection rather than granting global access', async () => {
    renderPage();

    const kubernetes = await screen.findByRole('group', { name: 'Kubernetes' });
    expect(within(kubernetes).getByText('kubernetes_list_namespaces')).toBeInTheDocument();
    expect(within(kubernetes).getByText('kubernetes_delete_resource')).toBeInTheDocument();
    const alpha = screen.getByRole('group', { name: 'Alpha' });
    expect(within(alpha).getByText('alpha_ping')).toBeInTheDocument();
    expect(within(kubernetes).getByText('destructive hint')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Enable kubernetes_list_namespaces' }));
    });

    expect(mocks.setToolOverride).toHaveBeenCalledWith(
      { pluginID: 'kubernetes', connectionID: 'prod' },
      'kubernetes_list_namespaces',
      { enabled: false, confirm: null },
    );
  });

  it('switches to a connection scope and exposes the access select', async () => {
    mocks.listTools.mockImplementation(async (scope: { connectionID: string }) => scope.connectionID
      ? [tool({ mcpName: 'production_only', connectionID: 'prod', ready: false, listed: false })]
      : [tool({}), tool({ mcpName: 'global_only' })]);
    renderPage();
    await screen.findByRole('group', { name: 'Kubernetes' });
    expect(screen.queryByRole('combobox', { name: 'Connection access' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Policy scope' }));
    const option = within(screen.getByRole('listbox')).getByRole('option', { name: 'Kubernetes · Production' });
    fireEvent.mouseMove(option);
    await act(async () => {
      fireEvent.click(option);
    });

    expect(await screen.findByRole('combobox', { name: 'Connection access' })).toBeInTheDocument();
    expect(mocks.listTools).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'prod' });
    expect(await screen.findByText('production_only')).toBeInTheDocument();
    expect(screen.queryByText('global_only')).not.toBeInTheDocument();
    expect(screen.queryByText('kubernetes_list_namespaces')).not.toBeInTheDocument();
    expect(screen.getByText('Route: prod · not ready · not advertised')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Connection access' }));
    const blocked = within(screen.getByRole('listbox')).getByRole('option', { name: 'Blocked' });
    fireEvent.mouseMove(blocked);
    await act(async () => {
      fireEvent.click(blocked);
    });
    expect(mocks.setConnectionAccess).toHaveBeenCalledWith('kubernetes', 'prod', 'blocked');
  });

  it('copies the Claude command with the token', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Kubernetes' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    });

    expect(mocks.writeText).toHaveBeenCalledWith(
      'claude mcp add --transport http omniview http://127.0.0.1:9590/mcp --header "Authorization: Bearer secret-token"',
    );
  });

  it('asks for confirmation before applying a preset', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Kubernetes' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Global preset' }));
    const all = within(screen.getByRole('listbox')).getByRole('option', { name: 'all (3 tools)' });
    fireEvent.mouseMove(all);
    await act(async () => {
      fireEvent.click(all);
    });

    expect(mocks.confirmShow).toHaveBeenCalledTimes(1);
    expect(mocks.applyPreset).not.toHaveBeenCalled();
    await act(async () => {
      await mocks.confirmShow.mock.calls[0][0].onConfirm();
    });
    expect(mocks.applyPreset).toHaveBeenCalledWith({ pluginID: '', connectionID: '' }, 'all');
  });

  it('preserves a status event when the initial status read finishes late', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    mocks.getStatus.mockReturnValue(promise);
    renderPage();
    await screen.findByRole('group', { name: 'Kubernetes' });
    await act(async () => {
      mocks.listeners.get('mcp/status')?.({ data: { running: true, endpoint: 'new-endpoint', error: '' } });
      resolve({ running: false, endpoint: '', error: '' });
    });
    expect(await screen.findByText('Running at new-endpoint')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('shows tool failure instead of empty inventory and recovers on retry', async () => {
    mocks.listTools.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([tool({})]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry tools' }));
    expect(await screen.findByText('kubernetes_list_namespaces')).toBeInTheDocument();
    expect(screen.queryByText('No plugin exposes tools yet.')).not.toBeInTheDocument();
  });

  it('blocks writes after failed authoritative configuration load', async () => {
    mocks.getConfig.mockRejectedValue(new Error('offline'));
    renderPage();
    await screen.findByRole('button', { name: 'Retry configuration' });
    const enabled = screen.getByRole('switch', { name: 'Enabled' });
    expect(enabled).toHaveAttribute('aria-disabled', 'true');
    const checked = enabled.getAttribute('aria-checked');
    await act(async () => {
      fireEvent.click(enabled);
      fireEvent.keyDown(enabled, { key: ' ' });
      fireEvent.keyUp(enabled, { key: ' ' });
    });
    expect(enabled).toHaveAttribute('aria-checked', checked);
    expect(screen.getByRole('button', { name: 'Rotate token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply port' })).toBeDisabled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it('refreshes visible tools and connection inventory on the same committed event', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Alpha' });
    mocks.listTools.mockResolvedValue([tool({ mcpName: 'replacement_tool' })]);
    mocks.listConnectionPolicies.mockResolvedValue([{ ...connections[0], connectionName: 'Replacement cluster' }]);
    await act(async () => mocks.listeners.get('mcp/tools_changed')?.({ data: undefined }));
    expect(await screen.findByText('replacement_tool')).toBeInTheDocument();
    expect(screen.queryByText('alpha_ping')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Policy scope' }));
    expect(await screen.findByRole('option', { name: 'Kubernetes · Replacement cluster' })).toBeInTheDocument();
  });

  it.each([
    ['Server status', 'getStatus'],
    ['Connection inventory', 'listConnectionPolicies'],
    ['Presets', 'listPresets'],
  ] as const)('shows recoverable %s failure instead of silently assuming state', async (label, method) => {
    mocks[method].mockRejectedValueOnce(new Error('offline'));
    if (method === 'getStatus') {
      mocks.getStatus.mockResolvedValue({ enabled: true, running: true, endpoint: 'recovered-endpoint', error: '' });
    } else if (method === 'listConnectionPolicies') {
      mocks.listConnectionPolicies.mockResolvedValue([{ ...connections[0], connectionName: 'Recovered connection' }]);
    } else {
      mocks.listPresets.mockResolvedValue([{ name: 'recovered-preset', builtIn: false, toolCount: 2 }]);
    }

    renderPage();
    const retry = await screen.findByRole('button', { name: `Retry ${label.toLowerCase()}` });
    expect(screen.getByText(`${label} could not be loaded.`)).toBeInTheDocument();
    if (method === 'getStatus') {
      expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
    }

    fireEvent.click(retry);
    if (method === 'getStatus') {
      expect(await screen.findByText('Running at recovered-endpoint')).toBeInTheDocument();
    } else if (method === 'listConnectionPolicies') {
      fireEvent.click(screen.getByRole('combobox', { name: 'Policy scope' }));
      expect(await screen.findByRole('option', { name: 'Kubernetes · Recovered connection' })).toBeInTheDocument();
    } else {
      expect(await screen.findByRole('button', { name: 'Delete preset recovered-preset' })).toBeInTheDocument();
    }

    expect(mocks[method]).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText(`${label} could not be loaded.`)).not.toBeInTheDocument());
  });

  it('does not disguise an unbound connection tool as a ready plugin route', async () => {
    mocks.listTools.mockResolvedValue([tool({ connectionID: '', ready: false, listed: false })]);
    renderPage();
    expect(await screen.findByText('Route: connection (not bound) · not ready · not advertised')).toBeInTheDocument();
    expect(screen.queryByText('Route: plugin · ready · advertised')).not.toBeInTheDocument();
  });
});
