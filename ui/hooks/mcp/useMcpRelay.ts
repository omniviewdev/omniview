import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { useSnackbar, createErrorHandler } from '@omniviewdev/runtime';
import { McpRelayClient } from '@omniviewdev/runtime/api';
import type { mcprelay } from '@omniviewdev/runtime/models';

export type McpScope = mcprelay.Scope;
export type McpToolOverride = mcprelay.ToolOverride;
export type McpToolView = mcprelay.ToolView;
export type McpConnectionPolicyView = mcprelay.ConnectionPolicyView;
export type McpPresetView = mcprelay.PresetView;
export type McpPendingConfirmation = mcprelay.PendingConfirmation;

export const GLOBAL_SCOPE: McpScope = { pluginID: '', connectionID: '' };

const ROOT_KEY = ['mcp'];

/**
 * State and mutations of the MCP relay (Settings → AI Tools).
 * Every mutation invalidates the whole `['mcp']` key; the backend also emits
 * `mcp/config_changed` and `mcp/tools_changed`, which invalidate too.
 */
export const useMcpRelay = (scope: McpScope = GLOBAL_SCOPE) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ROOT_KEY });
    };

    const offConfig = Events.On('mcp/config_changed', invalidate);
    const offTools = Events.On('mcp/tools_changed', invalidate);
    const offStatus = Events.On('mcp/status', (event) => {
      void queryClient.cancelQueries({ queryKey: [...ROOT_KEY, 'status'], exact: true });
      queryClient.setQueryData([...ROOT_KEY, 'status'], event.data);
    });
    return () => {
      offConfig();
      offTools();
      offStatus();
    };
  }, [queryClient]);

  const status = useQuery({
    queryKey: [...ROOT_KEY, 'status'],
    queryFn: async ({ signal }) => {
      const result = await McpRelayClient.GetStatus();
      signal.throwIfAborted();
      return result;
    },
  });

  const config = useQuery({
    queryKey: [...ROOT_KEY, 'config'],
    queryFn: async () => McpRelayClient.GetConfig(),
  });

  const tools = useQuery({
    queryKey: [...ROOT_KEY, 'tools', scope.pluginID, scope.connectionID],
    queryFn: async () => McpRelayClient.ListTools(scope),
  });

  const presets = useQuery({
    queryKey: [...ROOT_KEY, 'presets'],
    queryFn: async () => McpRelayClient.ListPresets(),
  });

  const connections = useQuery({
    queryKey: [...ROOT_KEY, 'connections'],
    queryFn: async () => McpRelayClient.ListConnectionPolicies(),
  });

  const mutationOptions = (failure: string) => ({
    onMutate: () => {
      if (!config.isSuccess || config.isFetching) {
        throw new Error('Load the current MCP configuration before changing policy.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROOT_KEY });
    },
    onError: createErrorHandler(showSnackbar, failure),
  });

  const setEnabled = useMutation({
    mutationFn: async (enabled: boolean) => McpRelayClient.SetEnabled(enabled),
    ...mutationOptions('Failed to change the MCP server state'),
  });

  const setPort = useMutation({
    mutationFn: async (port: number) => McpRelayClient.SetPort(port),
    ...mutationOptions('Failed to change the MCP server port'),
  });

  const rotateToken = useMutation({
    mutationFn: async () => McpRelayClient.RotateToken(),
    ...mutationOptions('Failed to rotate the token'),
  });

  const setBlockConnectionsByDefault = useMutation({
    mutationFn: async (block: boolean) => McpRelayClient.SetBlockConnectionsByDefault(block),
    ...mutationOptions('Failed to change the connection default'),
  });

  const setPluginEnabled = useMutation({
    mutationFn: async (input: { pluginID: string; enabled: boolean }) =>
      McpRelayClient.SetPluginEnabled(input.pluginID, input.enabled),
    ...mutationOptions('Failed to change the plugin switch'),
  });

  const setToolOverride = useMutation({
    mutationFn: async (input: { scope: McpScope; mcpName: string; override: McpToolOverride }) =>
      McpRelayClient.SetToolOverride(input.scope, input.mcpName, input.override),
    ...mutationOptions('Failed to change the tool override'),
  });

  const applyPreset = useMutation({
    mutationFn: async (input: { scope: McpScope; name: string }) =>
      McpRelayClient.ApplyPreset(input.scope, input.name),
    ...mutationOptions('Failed to apply the preset'),
  });

  const saveUserPreset = useMutation({
    mutationFn: async (name: string) => McpRelayClient.SaveUserPreset(name),
    ...mutationOptions('Failed to save the preset'),
  });

  const deleteUserPreset = useMutation({
    mutationFn: async (name: string) => McpRelayClient.DeleteUserPreset(name),
    ...mutationOptions('Failed to delete the preset'),
  });

  const setConnectionAccess = useMutation({
    mutationFn: async (input: { pluginID: string; connectionID: string; access: string }) =>
      McpRelayClient.SetConnectionAccess(input.pluginID, input.connectionID, input.access),
    ...mutationOptions('Failed to change the connection access'),
  });

  return {
    status,
    config,
    tools,
    presets,
    connections,
    setEnabled,
    setPort,
    rotateToken,
    setBlockConnectionsByDefault,
    setPluginEnabled,
    setToolOverride,
    applyPreset,
    saveUserPreset,
    deleteUserPreset,
    setConnectionAccess,
  };
};
