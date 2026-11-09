import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HostRecord } from '../../resource/v2/host';
import { useMetricObservation, type PreparedMetricResult, type ResourceMetricTarget, type UseMetricObservationOptions } from './useMetricObservation';

export interface UseTableMetricObservationOptions extends Pick<UseMetricObservationOptions,
  'ownerPluginID' | 'ownerConnectionID' | 'resourceKey' | 'bindingID' | 'source' | 'metricIDs' | 'intervalMs' | 'enabled'> {
  /** Current admitted membership, indexed by presentation body. Replace this map when records or membership change. */
  recordsByBody: WeakMap<object, HostRecord>;
  /** Pending source/catalog discovery, separate from background sample refresh. */
  loading?: boolean;
  /** A source/catalog failure prevents collection and takes precedence over observation errors. */
  error?: unknown;
}

export interface TableMetricObservation {
  metrics: ReadonlyMap<string, ReadonlyMap<string, PreparedMetricResult>>;
  /** Register in a cell effect. Multiple cells for one body share one target. Cleanup is idempotent. */
  register: (body: object) => () => void;
  /** Host-issued membership token, never an identity reconstructed from the body. */
  tokenFor: (body: object) => string | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

const visibilityListeners = new Set<() => void>();
const readVisibility = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const serverVisibility = () => true;
const notifyVisibility = () => visibilityListeners.forEach(listener => listener());
function subscribeVisibility(listener: () => void) {
  if (!visibilityListeners.size && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', notifyVisibility);
  }
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
    if (!visibilityListeners.size && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', notifyVisibility);
    }
  };
}

/**
 * Headless current-metric observation for any resource table. Cells register
 * presentation bodies; only admitted HostRecords supply references and routes.
 * Publish targets after 120 ms without membership changes, pause collection in
 * hidden documents, and retain settled cells during background refresh. This
 * timer batches view demand only: the host still owns polling and result reuse.
 */
export function useTableMetricObservation(options: UseTableMetricObservationOptions): TableMetricObservation {
  const visible = useSyncExternalStore(subscribeVisibility, readVisibility, serverVisibility);
  const mounted = useRef(new Map<object, number>());
  const timer = useRef<number | undefined>(undefined);
  const [bodies, setBodies] = useState<readonly object[]>([]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const register = useCallback((body: object) => {
    const publish = () => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setBodies(previous => previous.length === mounted.current.size && previous.every(item => mounted.current.has(item))
          ? previous : Array.from(mounted.current.keys()));
      }, 120);
    };
    const count = mounted.current.get(body) ?? 0;
    mounted.current.set(body, count + 1);
    if (!count) publish();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const count = (mounted.current.get(body) ?? 1) - 1;
      if (count > 0) mounted.current.set(body, count);
      else {
        mounted.current.delete(body);
        publish();
      }
    };
  }, []);
  const { recordsByBody } = options;
  const targets = useMemo<ResourceMetricTarget[]>(() => bodies.flatMap(body => {
    const record = recordsByBody.get(body);
    return record ? [{ token: record.key, reference: record.record.reference, route: record.route }] : [];
  }), [bodies, recordsByBody]);
  const enabled = options.enabled !== false && visible && !options.error && options.metricIDs.length > 0
    && targets.length > 0 && !!options.ownerConnectionID;
  const observation = useMetricObservation({ ownerPluginID: options.ownerPluginID, ownerConnectionID: options.ownerConnectionID,
    resourceKey: options.resourceKey, bindingID: options.bindingID, source: options.source,
    targets, metricIDs: options.metricIDs, shape: 'current', intervalMs: options.intervalMs ?? 30_000, enabled });
  const metrics = useMemo(() => {
    const map = new Map<string, Map<string, PreparedMetricResult>>();
    for (const result of observation.results) {
      let values = map.get(result.resourceToken);
      if (!values) { values = new Map(); map.set(result.resourceToken, values); }
      values.set(result.metricID, result);
    }
    return map;
  }, [observation.results]);
  const tokenFor = useCallback((body: object) => recordsByBody.get(body)?.key, [recordsByBody]);
  const error = options.error ?? observation.error;
  const isLoading = !error && (!!options.loading || (enabled && observation.isLoading));
  return useMemo(() => ({ metrics, register, tokenFor, error, isLoading,
    isFetching: observation.isFetching, refresh: observation.refresh }),
  [metrics, register, tokenFor, error, isLoading, observation.isFetching, observation.refresh]);
}
