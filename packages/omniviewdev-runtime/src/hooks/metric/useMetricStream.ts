import { useCallback, useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { Subscribe, Unsubscribe } from '../../metric';
import type { MetricResult } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { useResolvedPluginId } from '../useResolvedPluginId';
import type { Value, ResourceReference, AccessRoute } from '../../resource/v2/domain';


export type UseMetricStreamOptions = {
  /** The plugin providing metrics */
  pluginID?: string;
  /** The connection to stream metrics for */
  connectionID: string;
  /** The resource type key */
  resourceKey: string;
  /** The resource instance ID */
  resourceID: string;
  /** The resource namespace */
  resourceNamespace?: string;
  /** Canonical resource body, never the presentation projection. */
  resourceData?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  params?: Record<string, string>;
  /** Specific metric IDs to stream */
  metricIDs?: string[];
  /** Polling interval in milliseconds (default 10000) */
  interval?: number;
  /** Whether the stream is enabled */
  enabled?: boolean;
};

export type UseMetricStreamResult = {
  /** The latest stream output */
  data: MetricResult[] | null;
  /** The subscription ID */
  subscriptionID: string | null;
  /** Whether the stream is active */
  isStreaming: boolean;
  /** Error from the stream */
  error: string | null;
  /** Start the stream */
  start: () => Promise<void>;
  /** Stop the stream */
  stop: () => Promise<void>;
};

/**
 * Hook to subscribe to a real-time metric stream from a specific provider.
 * Uses Wails events for push-based data.
 */
export const useMetricStream = (
  opts: UseMetricStreamOptions,
): UseMetricStreamResult => {
  const {
    pluginID: explicitPluginID,
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace = '',
    resourceData,
    reference,
    route,
    params,
    metricIDs = [],
    interval = 10000,
    enabled = true,
  } = opts;
  const pluginID = useResolvedPluginId(explicitPluginID);

  const [data, setData] = useState<MetricResult[] | null>(null);
  const [subscriptionID, setSubscriptionID] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    if (!enabled || !pluginID || !connectionID || !resourceKey) {
      return;
    }

    try {
      const subID = await Subscribe(pluginID, connectionID, {
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_namespace: resourceNamespace,
        resource_data: resourceData,
        reference,
        route,
        params,
        metric_ids: metricIDs,
        interval: interval * 1_000_000, // ms to nanoseconds for Go time.Duration
      });

      setSubscriptionID(subID);
      setIsStreaming(true);
      setError(null);

      // Listen for data events
      const dataCleanup = Events.On(`core/metrics/data/${subID}`, (ev) => {
        const rawData = ev.data as string;
        try {
          const output = JSON.parse(rawData);
          if (output.results) {
            setData(output.results);
            setIsStreaming(true);
            setError(null);
          }
        } catch (e) {
          console.error('Failed to parse metric stream data:', e);
        }
      });

      // Listen for error events
      const errorCleanup = Events.On(`core/metrics/error/${subID}`, (ev) => {
        const rawData = ev.data as string;
        try {
          const output: unknown = JSON.parse(rawData);
          let message = 'Unknown error';
          if (output && typeof output === 'object') {
            if ('error' in output && typeof output.error === 'string' && output.error) message = output.error;
            if ('operation_error' in output) {
              const operationError = output.operation_error;
              if (operationError && typeof operationError === 'object' && 'message' in operationError && typeof operationError.message === 'string') message = operationError.message;
            }
          }
          setError(message);
          setIsStreaming(false);
        } catch (e) {
          setError('Failed to parse metric stream error');
        }
      });

      cleanupRef.current = () => {
        dataCleanup();
        errorCleanup();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pluginID, connectionID, resourceKey, resourceID, resourceNamespace, resourceData, reference, route, params, metricIDs, interval, enabled]);

  const stop = useCallback(async () => {
    if (subscriptionID) {
      try {
        await Unsubscribe(subscriptionID);
      } catch (e) {
        console.error('Failed to unsubscribe:', e);
      }
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setSubscriptionID(null);
    setIsStreaming(false);
  }, [subscriptionID]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (subscriptionID) {
        Unsubscribe(subscriptionID).catch(console.error);
      }
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, [subscriptionID]);

  return {
    data,
    subscriptionID,
    isStreaming,
    error,
    start,
    stop,
  };
};
