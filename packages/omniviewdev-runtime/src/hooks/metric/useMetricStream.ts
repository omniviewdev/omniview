import { useCallback, useEffect, useRef, useState } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { Subscribe, Unsubscribe } from '../../wailsjs/go/metric/Client';
import type { metric } from '../../wailsjs/go/models';
import { useResolvedPluginId } from '../useResolvedPluginId';

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
  /** The full resource data object */
  resourceData?: Record<string, unknown>;
  /** Specific metric IDs to stream */
  metricIDs?: string[];
  /** Polling interval in milliseconds (default 10000) */
  interval?: number;
  /** Whether the stream is enabled */
  enabled?: boolean;
};

export type UseMetricStreamResult = {
  /** The latest stream output */
  data: metric.MetricResult[] | null;
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
    resourceData = {},
    metricIDs = [],
    interval = 10000,
    enabled = true,
  } = opts;
  const pluginID = useResolvedPluginId(explicitPluginID);

  const [data, setData] = useState<metric.MetricResult[] | null>(null);
  const [subscriptionID, setSubscriptionID] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    if (!enabled || !pluginID || !connectionID || !resourceKey || !resourceID) {
      return;
    }

    try {
      const subID = await Subscribe(pluginID, connectionID, {
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_namespace: resourceNamespace,
        resource_data: resourceData as Record<string, any>,
        metric_ids: metricIDs,
        interval: interval * 1_000_000, // ms to nanoseconds for Go time.Duration
      } as any);

      setSubscriptionID(subID);
      setIsStreaming(true);
      setError(null);

      // Listen for data events
      const dataCleanup = EventsOn(`core/metrics/data/${subID}`, (rawData: string) => {
        try {
          const output = JSON.parse(rawData);
          if (output.results) {
            setData(output.results);
          }
        } catch (e) {
          console.error('Failed to parse metric stream data:', e);
        }
      });

      // Listen for error events
      const errorCleanup = EventsOn(`core/metrics/error/${subID}`, (rawData: string) => {
        try {
          const output = JSON.parse(rawData);
          setError(output.error || 'Unknown error');
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
  }, [pluginID, connectionID, resourceKey, resourceID, resourceNamespace, metricIDs, interval, enabled]);

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
