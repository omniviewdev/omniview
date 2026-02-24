import { useMemo } from 'react';
import { useResources } from '@omniviewdev/runtime';
import type { KubeEvent, TimelineEvent } from '@omniviewdev/ui/domain';

const MAX_EVENTS = 100;

export interface UseResourceEventsOptions {
  pluginID: string;
  connectionID: string;
  /** The resource key, e.g. "core::v1::Pod" */
  resourceKey: string;
  /** The specific resource name to filter events for */
  resourceName: string;
  /** The namespace the resource lives in */
  namespace: string;
  /** Only fetch when true — keeps the tab lazy */
  enabled?: boolean;
}

export interface UseResourceEventsResult {
  events: KubeEvent[];
  timelineEvents: TimelineEvent[];
  isLoading: boolean;
  warningCount: number;
}

/**
 * Extract the Kind portion from a resource key.
 * "core::v1::Pod" → "Pod", "apps::v1::Deployment" → "Deployment"
 */
function extractKind(resourceKey: string): string {
  const parts = resourceKey.split('::');
  return parts[parts.length - 1];
}

/**
 * Format a timestamp into a short relative age string.
 */
function formatAge(timestamp?: string): string {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Reusable hook that fetches Kubernetes Events scoped to a specific resource.
 *
 * Uses the existing `useResources` hook to pull `core::v1::Event` from the
 * informer cache, then filters client-side by `involvedObject.kind` + `name`.
 */
export function useResourceEvents({
  pluginID,
  connectionID,
  resourceKey,
  resourceName,
  namespace,
  enabled = true,
}: UseResourceEventsOptions): UseResourceEventsResult {
  const kind = extractKind(resourceKey);

  const { resources } = useResources({
    pluginID,
    connectionID,
    resourceKey: 'core::v1::Event',
    namespaces: namespace ? [namespace] : [],
    idAccessor: 'metadata.uid',
    ...(enabled ? {} : { listParams: { __skip: true } }),
  });

  const result = useMemo(() => {
    if (!enabled || !resources.data?.result) {
      return { events: [], timelineEvents: [], isLoading: false, warningCount: 0 };
    }

    const rawEvents = resources.data.result as Record<string, any>[];

    // Filter events belonging to this specific resource
    const filtered = rawEvents
      .filter((ev) => {
        const io = ev.involvedObject;
        if (!io) return false;
        return io.kind === kind && io.name === resourceName;
      })
      .sort((a, b) => {
        const tsA = a.lastTimestamp || a.firstTimestamp || a.metadata?.creationTimestamp || '';
        const tsB = b.lastTimestamp || b.firstTimestamp || b.metadata?.creationTimestamp || '';
        return new Date(tsB).getTime() - new Date(tsA).getTime();
      })
      .slice(0, MAX_EVENTS);

    const events: KubeEvent[] = filtered.map((ev) => ({
      type: (ev.type as 'Normal' | 'Warning') ?? 'Normal',
      reason: ev.reason ?? '',
      message: ev.message ?? '',
      count: ev.count,
      firstTimestamp: ev.firstTimestamp ?? ev.metadata?.creationTimestamp,
      lastTimestamp: ev.lastTimestamp,
      involvedObject: ev.involvedObject
        ? {
            kind: ev.involvedObject.kind,
            name: ev.involvedObject.name,
            namespace: ev.involvedObject.namespace,
          }
        : undefined,
    }));

    const timelineEvents: TimelineEvent[] = filtered.map((ev, i) => ({
      id: ev.metadata?.uid ?? String(i),
      title: ev.reason ?? 'Event',
      description: ev.message,
      timestamp: formatAge(ev.lastTimestamp ?? ev.firstTimestamp ?? ev.metadata?.creationTimestamp),
      color: ev.type === 'Warning' ? 'warning' as const : 'info' as const,
    }));

    const warningCount = events.filter((e) => e.type === 'Warning').length;

    return { events, timelineEvents, isLoading: false, warningCount };
  }, [enabled, resources.data, kind, resourceName]);

  return {
    ...result,
    isLoading: enabled && resources.isLoading,
  };
}
