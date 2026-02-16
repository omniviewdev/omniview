import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogsClient } from '@omniviewdev/runtime/api';
import type { LogEntry, LogStreamEvent } from '../types';
import { StreamEventType } from '../types';

interface LogSourceInfo {
  id: string;
  labels: Record<string, string>;
}

export interface FilterDimension {
  key: string;
  displayName: string;
  values: string[];
  selectedValues: Set<string>;
  allSelected: boolean;
}

interface UseLogSourcesOpts {
  sessionId: string;
  events: LogStreamEvent[];
  entries: LogEntry[];
  version: number;
}

export interface UseLogSourcesResult {
  sources: LogSourceInfo[];
  dimensions: FilterDimension[];
  toggleValue: (dimensionKey: string, value: string) => void;
  toggleAll: (dimensionKey: string) => void;
  selectedSourceIds: Set<string>;
  allSelected: boolean;
}

/** Capitalize first letter and add trailing 's' for simple pluralization. */
function toDisplayName(key: string): string {
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  return capitalized.endsWith('s') ? capitalized : capitalized + 's';
}

/**
 * Parse `filter_labels` param. Supports:
 * - `"pod,container"` → [{key:"pod"}, {key:"container"}]
 * - `"pod:Pods,container:Containers"` → [{key:"pod",displayName:"Pods"}, ...]
 */
function parseFilterLabels(raw: string): Array<{ key: string; displayName?: string }> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((segment) => {
      const colonIdx = segment.indexOf(':');
      if (colonIdx > 0) {
        return { key: segment.slice(0, colonIdx), displayName: segment.slice(colonIdx + 1) };
      }
      return { key: segment };
    });
}

export function useLogSources({ sessionId, events, entries, version }: UseLogSourcesOpts): UseLogSourcesResult {
  const [sources, setSources] = useState<LogSourceInfo[]>([]);
  // Per-dimension selection state: dimensionKey → Set of selected values
  const [selectionMap, setSelectionMap] = useState<Record<string, Set<string>>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedEventCount = useRef(0);

  // Declared dimension keys from session params (empty = auto-derive)
  const [declaredDimensions, setDeclaredDimensions] = useState<Array<{ key: string; displayName?: string }> | null>(null);

  // Fetch initial session sources + params on mount
  useEffect(() => {
    if (!sessionId) return;
    LogsClient.GetSession(sessionId)
      .then((session) => {
        const activeSources: LogSourceInfo[] = (session.active_sources || []).map((s: any) => ({
          id: s.id,
          labels: s.labels || {},
        }));
        if (activeSources.length > 0) {
          setSources(activeSources);
        }

        // Read filter_labels from session params
        const filterLabelsParam = session?.options?.params?.filter_labels;
        if (filterLabelsParam) {
          setDeclaredDimensions(parseFilterLabels(filterLabelsParam));
        }
      })
      .catch(() => {
        // Session may not exist yet, sources will arrive via entries/events
      });
  }, [sessionId]);

  // Derive sources from actual log entries as a fallback
  useEffect(() => {
    const sourceMap = new Map<string, LogSourceInfo>();
    for (const entry of entries) {
      if (entry.sourceId && !sourceMap.has(entry.sourceId)) {
        sourceMap.set(entry.sourceId, {
          id: entry.sourceId,
          labels: entry.labels || {},
        });
      }
    }

    if (sourceMap.size === 0) return;

    setSources((prev) => {
      const merged = new Map<string, LogSourceInfo>();
      for (const s of prev) merged.set(s.id, s);
      let changed = false;
      for (const [id, info] of sourceMap) {
        if (!merged.has(id)) {
          merged.set(id, info);
          changed = true;
        }
      }
      if (!changed) return prev;
      return Array.from(merged.values());
    });
  }, [version]);

  // Track SOURCE_ADDED/SOURCE_REMOVED events
  useEffect(() => {
    if (events.length <= processedEventCount.current) return;

    const newEvents = events.slice(processedEventCount.current);
    processedEventCount.current = events.length;

    for (const event of newEvents) {
      if (!event.source_id) continue;

      if (event.type === StreamEventType.SOURCE_ADDED) {
        setSources((prev) => {
          if (prev.some((s) => s.id === event.source_id)) return prev;
          return [...prev, { id: event.source_id, labels: {} }];
        });
      }
      // NOTE: We intentionally do NOT remove sources on SOURCE_REMOVED.
      // The dropdown should always show all known sources so users can
      // re-select them. Removal would cause items to vanish when deselected.
    }
  }, [events]);

  // Build dimensions from sources + declared/auto-derived keys
  const dimensionKeys = useMemo(() => {
    if (declaredDimensions) return declaredDimensions;

    // Auto-derive: find label keys with >1 unique value
    const keyValues = new Map<string, Set<string>>();
    for (const source of sources) {
      for (const [key, val] of Object.entries(source.labels)) {
        if (!keyValues.has(key)) keyValues.set(key, new Set());
        keyValues.get(key)!.add(val);
      }
    }

    const derived: Array<{ key: string; displayName?: string }> = [];
    for (const [key, vals] of Array.from(keyValues.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (vals.size > 1) {
        derived.push({ key });
      }
    }
    return derived;
  }, [declaredDimensions, sources]);

  // Build full dimension objects with values and selection state
  const dimensions: FilterDimension[] = useMemo(() => {
    return dimensionKeys.map(({ key, displayName }) => {
      const valuesSet = new Set<string>();
      for (const source of sources) {
        const val = source.labels[key];
        if (val) valuesSet.add(val);
      }
      const values = Array.from(valuesSet).sort();
      const selectedValues = selectionMap[key] ?? new Set(values);
      const allSelected = values.length > 0 && values.every((v) => selectedValues.has(v));

      return { key, displayName: displayName ?? toDisplayName(key), values, selectedValues, allSelected };
    });
  }, [dimensionKeys, sources, selectionMap]);

  // Auto-select new values when sources change
  useEffect(() => {
    setSelectionMap((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const dim of dimensionKeys) {
        const currentSet = prev[dim.key];
        if (!currentSet) continue; // Not initialized yet → will use default (all selected)

        for (const source of sources) {
          const val = source.labels[dim.key];
          if (val && !currentSet.has(val)) {
            if (!changed) {
              changed = true;
            }
            if (next[dim.key] === currentSet) {
              next[dim.key] = new Set(currentSet);
            }
            next[dim.key].add(val);
          }
        }
      }

      return changed ? next : prev;
    });
  }, [sources, dimensionKeys]);

  // Compute selectedSourceIds: a source is included if all its dimension labels are selected
  const selectedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const source of sources) {
      const match = dimensions.every((dim) => {
        const val = source.labels[dim.key];
        return !val || dim.selectedValues.has(val);
      });
      if (match) ids.add(source.id);
    }
    return ids;
  }, [sources, dimensions]);

  const allSelected = useMemo(
    () => sources.length > 0 && selectedSourceIds.size === sources.length,
    [sources.length, selectedSourceIds.size],
  );

  // Debounced backend sync
  const syncToBackend = useCallback(
    (ids: Set<string>, allSources: LogSourceInfo[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const all = ids.size === allSources.length;
        LogsClient.UpdateSessionOptions(sessionId, {
          params: { enabled_sources: all ? '' : Array.from(ids).join(',') },
        } as any).catch(() => {
          // Best effort
        });
      }, 300);
    },
    [sessionId],
  );

  // Sync when selectedSourceIds changes
  const prevSelectedRef = useRef<Set<string>>(selectedSourceIds);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedSourceIds) {
      prevSelectedRef.current = selectedSourceIds;
      syncToBackend(selectedSourceIds, sources);
    }
  }, [selectedSourceIds, sources, syncToBackend]);

  const toggleValue = useCallback(
    (dimensionKey: string, value: string) => {
      setSelectionMap((prev) => {
        const dim = dimensions.find((d) => d.key === dimensionKey);
        if (!dim) return prev;

        const currentSet = prev[dimensionKey] ?? new Set(dim.values);
        const next = new Set(currentSet);

        if (next.has(value)) {
          // Don't deselect if it would result in zero selected across all sources
          if (next.size <= 1) return prev;
          next.delete(value);
        } else {
          next.add(value);
        }

        return { ...prev, [dimensionKey]: next };
      });
    },
    [dimensions],
  );

  const toggleAll = useCallback(
    (dimensionKey: string) => {
      setSelectionMap((prev) => {
        const dim = dimensions.find((d) => d.key === dimensionKey);
        if (!dim) return prev;

        const currentSet = prev[dimensionKey] ?? new Set(dim.values);
        const allCurrentlySelected = dim.values.every((v) => currentSet.has(v));

        const next = allCurrentlySelected
          ? new Set([dim.values[0]].filter(Boolean)) // Keep at least one
          : new Set(dim.values);

        return { ...prev, [dimensionKey]: next };
      });
    },
    [dimensions],
  );

  return { sources, dimensions, toggleValue, toggleAll, selectedSourceIds, allSelected };
}
