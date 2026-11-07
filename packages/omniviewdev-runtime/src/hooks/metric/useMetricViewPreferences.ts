import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { MetricViewPreferences } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { GetMetricViewPreferences, SaveMetricViewPreferences } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';
export type { MetricViewPreferences } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';

export type MetricViewPreferencePatch = Partial<Omit<MetricViewPreferences, 'version' | 'revision'>>;
export type MetricViewPreferenceUpdate = MetricViewPreferencePatch | ((current: Readonly<MetricViewPreferences>) => MetricViewPreferencePatch);
interface PreferenceSnapshot {
  preferences: MetricViewPreferences;
  isLoading: boolean;
  error: Error | null;
}
interface PreferenceEntry {
  ownerPluginID: string;
  resourceKey: string;
  initial: MetricViewPreferencePatch;
  snapshot: PreferenceSnapshot;
  listeners: Set<() => void>;
  queue: Promise<void>;
  loading: Promise<void> | null;
  sequence: number;
  pendingSaves: number;
}
// Presentation metadata only: this is not a metric-result cache or network scheduler.
// A runtime window is bound to one authenticated host profile/session.
const entries = new Map<string, PreferenceEntry>();
const EMPTY_INITIAL: MetricViewPreferencePatch = Object.freeze({});

function initialPreferences(initial: MetricViewPreferencePatch): MetricViewPreferences {
  return { version: 1, revision: 0, metric_ids: [], displays: {}, layout: 'auto',
    time_mode: 'relative', duration_ms: 3_600_000, start_ms: 0, end_ms: 0, details: {}, ...initial };
}
function publish(entry: PreferenceEntry, snapshot: PreferenceSnapshot) {
  Object.freeze(snapshot.preferences.metric_ids);
  Object.freeze(snapshot.preferences.displays);
  Object.freeze(snapshot.preferences.details);
  Object.freeze(snapshot.preferences);
  entry.snapshot = Object.freeze(snapshot);
  for (const listener of entry.listeners) listener();
}
function readPreferences(entry: PreferenceEntry, stored: MetricViewPreferences): MetricViewPreferences {
  // Revision zero is uninitialized. A persisted empty selection must remain empty.
  return stored.revision === 0 ? { ...stored, ...entry.initial,
    version: stored.version, revision: stored.revision,
    displays: { ...stored.displays, ...entry.initial.displays },
    details: { ...stored.details, ...entry.initial.details },
  } : stored;
}
function getEntry(ownerPluginID: string, resourceKey: string, initial: MetricViewPreferencePatch): PreferenceEntry {
  const scope = JSON.stringify([ownerPluginID, resourceKey]);
  const found = entries.get(scope);
  if (found) return found;
  if (entries.size >= 64) {
    for (const [key, candidate] of entries) {
      if (!candidate.listeners.size && !candidate.loading && !candidate.pendingSaves) { entries.delete(key); break; }
    }
  }
  if (entries.size >= 64) throw new RangeError('Metrics preferences exceed 64 active resource scopes.');
  const entry: PreferenceEntry = { ownerPluginID, resourceKey, initial,
    snapshot: { preferences: initialPreferences(initial), isLoading: true, error: null },
    listeners: new Set(), queue: Promise.resolve(), loading: null, sequence: 0, pendingSaves: 0 };
  publish(entry, entry.snapshot);
  entries.set(scope, entry);
  return entry;
}
function load(entry: PreferenceEntry) {
  if (entry.loading) return;
  const sequence = ++entry.sequence;
  entry.loading = GetMetricViewPreferences(entry.ownerPluginID, entry.resourceKey).then(stored => {
    if (entry.sequence === sequence) publish(entry, { preferences: readPreferences(entry, stored), isLoading: false, error: null });
  }).catch(error => {
    if (entry.sequence === sequence) publish(entry, { ...entry.snapshot, isLoading: false, error: error instanceof Error ? error : new Error(String(error)) });
  }).finally(() => { entry.loading = null; });
}

function enqueuePreferenceUpdate(entry: PreferenceEntry, change: MetricViewPreferenceUpdate): Promise<void> {
  entry.pendingSaves++;
  const operation = entry.queue.then(async () => {
    ++entry.sequence;
    try {
      const latest = readPreferences(entry, await GetMetricViewPreferences(entry.ownerPluginID, entry.resourceKey));
      const patch = typeof change === 'function' ? change(latest) : change;
      const next = { ...latest, ...patch,
        displays: { ...latest.displays, ...patch.displays }, details: { ...latest.details, ...patch.details } };
      await SaveMetricViewPreferences(entry.ownerPluginID, entry.resourceKey, next);
      const stored = await GetMetricViewPreferences(entry.ownerPluginID, entry.resourceKey);
      publish(entry, { preferences: readPreferences(entry, stored), isLoading: false, error: null });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      publish(entry, { ...entry.snapshot, isLoading: false, error: failure });
      throw failure;
    } finally { entry.pendingSaves--; }
  });
  // A failed save stays observable but does not prevent a later explicit save.
  entry.queue = operation.catch(() => undefined);
  return operation;
}

/**
 * Durable profile preferences, shared immediately across metrics surfaces in this window.
 * The resource-owning view supplies initial defaults; generic storage never invents
 * Kubernetes metric IDs. Defaults apply only before the first persisted revision.
 *
 * Saves merge a field patch into the latest host revision, then use Revision CAS.
 * Functional updates resolve inside the shared save queue, so rapid toggles compose.
 * Conflicts and storage failures remain visible; no blind retry overwrites another window.
 * Relative and applied absolute time choices survive resource navigation and restart.
 *
 * @example
 * const view = useMetricViewPreferences(pluginID, resourceKey, { metric_ids: defaultIDs });
 * await view.update(current => ({ metric_ids: current.metric_ids.filter(id => id !== removedID) }));
 */
export function useMetricViewPreferences(ownerPluginID: string, resourceKey: string, initial: MetricViewPreferencePatch = EMPTY_INITIAL) {
  const entry = useMemo(() => getEntry(ownerPluginID, resourceKey, initial), [ownerPluginID, resourceKey, initial]);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    if (entry.listeners.size === 1) load(entry);
    return () => { entry.listeners.delete(listener); };
  }, [entry]);
  const getSnapshot = useCallback(() => entry.snapshot, [entry]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const update = useCallback((change: MetricViewPreferenceUpdate) => enqueuePreferenceUpdate(entry, change), [entry]);
  return { ...state, update };
}
