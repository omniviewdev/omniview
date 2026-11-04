import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { QueryResources, type ResourceSetQueryRequest } from '../../metric';
import { metricRequestKey, ResourceSetScheduler, type ResourceSetSnapshot, type ResourceSetSubscription } from './resourceSetScheduler';

export interface UseResourceSetMetricsOptions {
  enabled?: boolean;
  /** Milliseconds; zero disables polling. Compatible consumers share one schedule. */
  refreshInterval?: number;
}
export interface UseResourceSetMetricsResult extends ResourceSetSnapshot {
  refetch: () => void;
}
const scheduler = new ResourceSetScheduler(QueryResources);
const idle: ResourceSetSnapshot = { error: null, isLoading: false, isFetching: false };

/** Explicit finite resources only. No empty-ID expansion or implicit provider selection. */
export function useResourceSetMetrics(
  request: ResourceSetQueryRequest | undefined,
  { enabled = true, refreshInterval = 0 }: UseResourceSetMetricsOptions = {},
): UseResourceSetMetricsResult {
  const key = request ? metricRequestKey(request) : '';
  // Structural identity prevents inline request literals from restarting subscriptions.
  const stableRequest = useMemo(() => request, [key]);
  const active = enabled && !!stableRequest?.resources?.length;
  const [state, setState] = useState<{ key: string; snapshot: ResourceSetSnapshot }>({ key: '', snapshot: idle });
  const refetchRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!active || !stableRequest) { refetchRef.current = undefined; return; }
    let live = true;
    let subscription: ResourceSetSubscription;
    try {
      subscription = scheduler.subscribe(stableRequest, refreshInterval, () => {
        if (live) setState({ key, snapshot: subscription.snapshot() });
      });
    } catch (error) {
      refetchRef.current = undefined;
      setState({ key, snapshot: { ...idle, error: error instanceof Error ? error : new Error(String(error)) } });
      return;
    }
    refetchRef.current = subscription.refetch;
    setState({ key, snapshot: subscription.snapshot() });
    return () => {
      live = false;
      refetchRef.current = undefined;
      subscription.unsubscribe();
    };
  }, [stableRequest, key, active, refreshInterval]);
  const refetch = useCallback(() => refetchRef.current?.(), []);
  const snapshot = !active ? idle : state.key === key ? state.snapshot : { ...idle, isLoading: true };
  return { ...snapshot, refetch };
}
