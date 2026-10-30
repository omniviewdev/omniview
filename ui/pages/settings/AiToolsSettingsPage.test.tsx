import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmationModalContext } from '@omniviewdev/runtime';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';

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
  writeText: vi.fn(),
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
    SetPort: vi.fn(),
    RotateToken: vi.fn(),
    SetBlockConnectionsByDefault: vi.fn(),
    SetPluginEnabled: vi.fn(),
    SaveUserPreset: vi.fn(),
    DeleteUserPreset: vi.fn(),
  },
}));

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof WailsRuntime>();
  return {
    ...original,
    Events: { ...original.Events, On: () => () => undefined },
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppSnackbarProvider>
        <ConfirmationModalContext.Provider value={{ show: mocks.confirmShow }}>
          <AiToolsSettingsPage />
        </ConfirmationModalContext.Provider>
      </AppSnackbarProvider>
    </QueryClientProvider>,
  );
}

describe('AiToolsSettingsPage', () => {
  beforeEach(() => {
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
    mocks.confirmShow.mockReset();
    mocks.writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
  });

  afterEach(cleanup);

  it('groups tools by plugin and writes an override when a tool is toggled', async () => {
    renderPage();

    const kubernetes = await screen.findByRole('group', { name: 'Kubernetes' });
    expect(within(kubernetes).getByText('kubernetes_list_namespaces')).toBeInTheDocument();
    expect(within(kubernetes).getByText('kubernetes_delete_resource')).toBeInTheDocument();
    const alpha = screen.getByRole('group', { name: 'Alpha' });
    expect(within(alpha).getByText('alpha_ping')).toBeInTheDocument();
    expect(within(kubernetes).getByText('destructive')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Enable kubernetes_list_namespaces' }));
    });

    expect(mocks.setToolOverride).toHaveBeenCalledWith(
      { pluginID: '', connectionID: '' },
      'kubernetes_list_namespaces',
      { enabled: false, confirm: null },
    );
  });

  it('switches to a connection scope and exposes the access select', async () => {
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
});
