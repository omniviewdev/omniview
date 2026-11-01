import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryFilters } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { SettingsService as Service } from '../../api';
import type { Category, Setting, ValidationResult } from '../../bindings/github.com/omniviewdev/plugin-sdk/settings/models';
import type { CommitResult, Snapshot } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/settings/models';

export type SettingsScope = { kind: 'host'; pluginId?: never } | { kind: 'plugin'; pluginId: string };
export const HOST_SETTINGS_SCOPE: SettingsScope = { kind: 'host' };
export type SettingsSetting = Setting;
export type SettingsCategory = Category;
export type SettingsSnapshot = Omit<Snapshot, 'scope'> & { scope: SettingsScope };
export type SettingsCommitResult = Omit<CommitResult, 'snapshot'> & { snapshot: SettingsSnapshot };
export type SettingsValidationResult = ValidationResult;
export const settingsQueryKey = (scope: SettingsScope) =>
  ['settings', scope.kind, scope.kind === 'plugin' ? scope.pluginId : ''] as const;
const emptyCategories: SettingsSnapshot['categories'] = {};

async function refresh(client: QueryClient, filters: QueryFilters): Promise<void> {
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}

// Share transport listeners per existing query client, not per settings consumer.
const bridges = new WeakMap<QueryClient, { users: number; stop: () => void }>();
function subscribe(client: QueryClient): () => void {
  let bridge = bridges.get(client);
  if (!bridge) {
    const invalidate = (scope?: SettingsScope) => {
      const queryKey = scope ? ['settings', scope.kind, scope.kind === 'plugin' ? scope.pluginId : ''] : ['settings', 'plugin'];
      void refresh(client, { queryKey });
    };
    const cleanups = [
      Events.On('settings/changed', (event) => { invalidate(event.data as SettingsScope); }),
      Events.On('plugin/init_complete', () => invalidate()),
      Events.On('plugin/inventory_changed', () => invalidate()),
      Events.On('plugin/dev_reload_complete', () => invalidate()),
      Events.On('plugin/recovered', () => invalidate()),
      Events.On('plugin/dev_install_complete', (event) => {
        const id = event.data?.id;
        if (typeof id === 'string') invalidate({ kind: 'plugin', pluginId: id });
      }),
    ];
    bridge = { users: 0, stop: () => { for (const stop of cleanups) stop(); } };
    bridges.set(client, bridge);
  }
  bridge.users++;
  return () => {
    if (--bridge.users === 0) { bridge.stop(); bridges.delete(client); }
  };
}

/** Host IDs are canonical category.setting IDs; plugin IDs remain opaque. */
export function scopedSettingID(scope: SettingsScope, category: string, id: string): string {
  return scope.kind === 'host' ? `${category}.${id}` : id;
}

export function useScopedSettings(scope: SettingsScope) {
  const client = useQueryClient();
  const kind = scope.kind;
  const pluginId = scope.pluginId;
  useEffect(() => subscribe(client), [client]);
  const query = useQuery({
    queryKey: settingsQueryKey(scope),
    queryFn: async ({ signal }) => {
      const snapshot = await Service.GetSnapshot(scope);
      signal.throwIfAborted();
      return snapshot as SettingsSnapshot;
    },
    staleTime: Infinity,
    retry: false,
  });
  const { mutateAsync: commit } = useMutation({
    mutationFn: async (values: Record<string, unknown>): Promise<SettingsCommitResult> => {
      const result = await Service.Commit(scope, values) as SettingsCommitResult;
      // Successful RPC means durable. Refresh failures must not turn a saved commit into rejection.
      await refresh(client, { queryKey: ['settings', kind, pluginId ?? ''] });
      return result;
    },
  });
  const validate = useCallback((id: string, value: unknown): Promise<SettingsValidationResult> =>
    Service.Validate(kind === 'host' ? HOST_SETTINGS_SCOPE : { kind, pluginId: pluginId! }, id, value), [kind, pluginId]);
  return { snapshot: query.data, categories: query.data?.categories ?? emptyCategories,
    isLoading: query.isPending, error: query.error ?? undefined, commit, validate };
}
