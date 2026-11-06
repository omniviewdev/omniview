import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { MetricSourceRef, MetricViewSourceSelection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { GetMetricViewSourceSelection, SaveMetricViewSourceSelection } from '../../metric';

export type MetricViewSourceMode = 'inherit' | 'native' | 'external';
type Change = { mode: MetricViewSourceMode; source?: MetricSourceRef };
interface SourceMutation {
  scope: string;
  sequence: number;
  saving: boolean;
  attempted: Change | null;
  error: Error | null;
}

/**
 * Host-durable routing, scoped by owner connection and resource kind, not presentation.
 * Inherit resolves connection/per-metric defaults, then global defaults, then native.
 * Explicit choices never fall back. Failed CAS saves remain visible and are not retried.
 */
export function useMetricViewSourceSelection(ownerPluginID: string, ownerConnectionID: string, resourceKey: string) {
  const client = useQueryClient();
  const queryKey = ['metric', 'view-source', ownerPluginID, ownerConnectionID, resourceKey];
  const scope = JSON.stringify(queryKey);
  const query = useQuery({ queryKey,
    queryFn: () => GetMetricViewSourceSelection(ownerPluginID, ownerConnectionID, resourceKey),
    enabled: !!ownerPluginID && !!ownerConnectionID && !!resourceKey,
    retry: false,
  });
  const sequence = useRef(0);
  const [mutation, setMutation] = useState<SourceMutation>({ scope: '', sequence: 0, saving: false, attempted: null, error: null });
  const update = async (mode: MetricViewSourceMode, source?: MetricSourceRef) => {
    const operation = ++sequence.current;
    const change = { mode, source };
    setMutation({ scope, sequence: operation, saving: true, attempted: change, error: null });
    try {
      // A pending read must not overwrite a newer host-acknowledged revision.
      await client.cancelQueries({ queryKey, exact: true });
      const loaded = client.getQueryData<MetricViewSourceSelection>(queryKey);
      if (!loaded) throw new Error('Metric source selection has not loaded.');
      if (mode === 'external' && !source) throw new Error('Select an external metric source.');
      const stored = await SaveMetricViewSourceSelection({ ...loaded, mode, source: mode === 'external' ? source : undefined });
      if (!stored) throw new Error('No metric source selection response.');
      client.setQueryData(queryKey, stored);
      setMutation(current => current.scope === scope && current.sequence === operation
        ? { ...current, saving: false, attempted: null, error: null } : current);
      await client.invalidateQueries({ queryKey: ['metric', 'catalog', {
        owner_plugin_id: ownerPluginID, owner_connection_id: ownerConnectionID, resource_key: resourceKey,
      }] });
      return stored;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      setMutation(current => current.scope === scope && current.sequence === operation
        ? { ...current, saving: false, error: failure } : current);
      throw failure;
    }
  };
  const sameScope = mutation.scope === scope;
  // Read the single query cache on mutation renders: observer notifications may be batched.
  const admitted = client.getQueryData<MetricViewSourceSelection>(queryKey) ?? query.data;
  const attempted = sameScope && mutation.error ? mutation.attempted : null;
  const selection = admitted && attempted ? { ...admitted, mode: attempted.mode, source: attempted.source } : admitted;
  return { selection, isLoading: query.isLoading, isSaving: sameScope && mutation.saving,
    error: (sameScope ? mutation.error : null) ?? query.error, update, reload: query.refetch };
}
