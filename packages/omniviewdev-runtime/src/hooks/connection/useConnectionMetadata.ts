import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Events } from '@wailsio/runtime';
import { GetConnectionMetadata, RefreshConnectionMetadata } from '../../resource/v2/client';
import type { ConnectionMetadataEnvelope, ConnectionMetadataSnapshot } from '../../connection/metadata';
import { useResolvedPluginId } from '../useResolvedPluginId';

export interface ConnectionMetadataState {
  supported: boolean | undefined;
  transportAvailable: boolean;
  snapshot?: ConnectionMetadataSnapshot;
  isLoading: boolean;
  error?: unknown;
}
const empty: ConnectionMetadataState = { supported: undefined, transportAvailable: false, isLoading: false };
interface Cache {
  pluginID: string;
  connectionID: string;
  state: ConnectionMetadataState;
  listeners: Set<() => void>;
  revision?: bigint;
  epoch: number;
  eventVersion: number;
  pending?: Promise<void>;
}
interface Provider { registrationID?: string; retired: Set<string>; connections: Map<string, Cache> }
const providers = new Map<string, Provider>();
let unsubscribe: (() => void) | undefined;
let subscribers = 0;

function publish(cache: Cache, patch: Partial<ConnectionMetadataState>) {
  const next = { ...cache.state, ...patch };
  if (Object.keys(next).every(key => Object.is(next[key as keyof ConnectionMetadataState], cache.state[key as keyof ConnectionMetadataState]))) return;
  cache.state = next;
  cache.listeners.forEach(listener => listener());
}
function getCache(pluginID: string, connectionID: string): Cache {
  let provider = providers.get(pluginID);
  if (!provider) { provider = { retired: new Set(), connections: new Map() }; providers.set(pluginID, provider); }
  let cache = provider.connections.get(connectionID);
  if (!cache) {
    cache = { pluginID, connectionID, state: empty, listeners: new Set(), epoch: 0, eventVersion: 0 };
    provider.connections.set(connectionID, cache);
  }
  return cache;
}
function revisionOf(value: string | undefined): bigint | undefined {
  return value && /^[0-9]+$/.test(value) ? BigInt(value) : undefined;
}
/** Metadata contains only bounded JSON values and its handwritten envelope. */
function metadataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(rightRecord, key) && metadataEqual(leftRecord[key], rightRecord[key]));
}
function shareSnapshot(previous: ConnectionMetadataSnapshot | undefined, next: ConnectionMetadataSnapshot): ConnectionMetadataSnapshot {
  if (!previous) return next;
  const entries = { ...next.entries };
  let unchanged = Object.keys(previous.entries).length === Object.keys(entries).length;
  for (const key of Object.keys(entries)) {
    if (metadataEqual(previous.entries[key], entries[key])) entries[key] = previous.entries[key];
    else unchanged = false;
  }
  return { ...next, entries: unchanged ? previous.entries : entries };
}
function accept(envelope: ConnectionMetadataEnvelope, fromEvent: boolean) {
  const provider = providers.get(envelope.pluginID);
  if (!provider || provider.retired.has(envelope.registrationID)) return;
  if (provider.registrationID !== envelope.registrationID) {
    // Only lifecycle events can replace an established registration. Delayed RPCs cannot.
    if (provider.registrationID && !fromEvent) return;
    if (provider.registrationID) {
      provider.retired.add(provider.registrationID);
      for (const cache of provider.connections.values()) {
        cache.epoch++;
        cache.pending = undefined;
        cache.revision = undefined;
        publish(cache, { ...empty, snapshot: undefined, error: undefined });
      }
    }
    provider.registrationID = envelope.registrationID;
  }
  const id = envelope.snapshot?.connectionID ?? envelope.connectionID;
  const targets = id === undefined ? [...provider.connections.values()] : [provider.connections.get(id)].filter((cache): cache is Cache => !!cache);
  for (const cache of targets) {
    if (fromEvent) cache.eventVersion++;
    const wasAvailable = cache.state.transportAvailable;
    const revision = revisionOf(envelope.snapshot?.revision ?? envelope.revision);
    if (revision !== undefined && (cache.revision === undefined || revision > cache.revision)) {
      cache.revision = revision;
      publish(cache, { snapshot: envelope.removed ? undefined : envelope.snapshot ? shareSnapshot(cache.state.snapshot, envelope.snapshot) : cache.state.snapshot });
    }
    if (!envelope.transportAvailable) {
      cache.epoch++;
      cache.pending = undefined;
      publish(cache, { supported: envelope.supported, transportAvailable: false, isLoading: false });
      continue;
    }
    if (id === undefined) {
      // Unsupported metadata needs no connection read to establish transport availability.
      publish(cache, { supported: envelope.supported, transportAvailable: !envelope.supported });
      if (envelope.supported && cache.listeners.size) void request(cache, false);
      else publish(cache, { isLoading: false, error: undefined });
      continue;
    }
    // Equal revisions still acknowledge a successful resynchronization.
    publish(cache, { supported: envelope.supported, transportAvailable: !fromEvent || wasAvailable, isLoading: false, error: undefined });
    if (fromEvent && !wasAvailable && cache.listeners.size) void request(cache, false);
  }
}
function request(cache: Cache, refresh: boolean): Promise<void> {
  if (!cache.listeners.size || cache.state.supported === false) return Promise.resolve();
  if (!refresh && cache.pending) return cache.pending;
  const epoch = cache.epoch;
  const eventVersion = cache.eventVersion;
  publish(cache, { isLoading: true, error: undefined });
  const call = refresh ? RefreshConnectionMetadata : GetConnectionMetadata;
  const pending = Promise.resolve().then(() => {
    if (cache.epoch !== epoch || !cache.listeners.size || cache.state.supported === false) return;
    return call(cache.pluginID, cache.connectionID);
  }).then(envelope => {
    if (!envelope || cache.epoch !== epoch || !cache.listeners.size || envelope.pluginID !== cache.pluginID) return;
    const id = envelope.snapshot?.connectionID ?? envelope.connectionID;
    if (id !== undefined && id !== cache.connectionID) return;
    accept({ ...envelope, connectionID: cache.connectionID }, false);
  }).catch(error => {
    // Unary errors describe this operation, not the provider's metadata watch transport.
    if (cache.epoch === epoch && cache.eventVersion === eventVersion && cache.listeners.size) publish(cache, { error, isLoading: false });
  }).finally(() => {
    if (cache.pending === pending) cache.pending = undefined;
    if (cache.epoch === epoch && cache.listeners.size) publish(cache, { isLoading: false });
  });
  if (!refresh) cache.pending = pending;
  return pending;
}
function subscribe(cache: Cache, listener: () => void) {
  cache.listeners.add(listener);
  if (subscribers++ === 0) unsubscribe = Events.On('resource/connection/metadata', event => accept(event.data as ConnectionMetadataEnvelope, true));
  if (cache.listeners.size === 1) void request(cache, false);
  return () => {
    cache.listeners.delete(listener);
    if (!cache.listeners.size) {
      cache.epoch++;
      cache.pending = undefined;
      providers.get(cache.pluginID)?.connections.delete(cache.connectionID);
    }
    if (--subscribers === 0) {
      unsubscribe?.();
      unsubscribe = undefined;
      providers.clear();
    }
  };
}

/** Reading subscribes and fetches only; it never connects or acquires observations. */
export function useConnectionMetadata(explicitPluginID: string | undefined, connectionID: string | undefined): ConnectionMetadataState & { refresh: () => Promise<void> } {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const enabled = pluginID !== undefined && connectionID !== undefined;
  const listen = useCallback((listener: () => void) => enabled ? subscribe(getCache(pluginID!, connectionID!), listener) : () => {}, [enabled, pluginID, connectionID]);
  const read = useCallback(() => enabled ? getCache(pluginID!, connectionID!).state : empty, [enabled, pluginID, connectionID]);
  const state = useSyncExternalStore(listen, read, () => empty);
  const refresh = useCallback(() => {
    const cache = enabled ? providers.get(pluginID!)?.connections.get(connectionID!) : undefined;
    return cache ? request(cache, true) : Promise.resolve();
  }, [enabled, pluginID, connectionID]);
  return { ...state, refresh };
}

function createConnectionsStore(pluginID: string, identity: string) {
  const ids = JSON.parse(identity) as string[];
  let snapshot: ReadonlyMap<string, ConnectionMetadataState> = new Map();
  return {
    subscribe(listener: () => void) {
      const cancels = ids.map(id => subscribe(getCache(pluginID, id), listener));
      return () => cancels.forEach(cancel => cancel());
    },
    read() {
      const states = ids.map(id => getCache(pluginID, id).state);
      if (snapshot.size !== ids.length || ids.some((id, index) => snapshot.get(id) !== states[index])) {
        snapshot = new Map(ids.map((id, index) => [id, states[index]]));
      }
      return snapshot;
    },
  };
}

/** Subscribe to a dynamic connection inventory without invoking hooks in a loop. */
export function useConnectionMetadataConnections(explicitPluginID: string | undefined, connectionIDs: readonly string[]): ReadonlyMap<string, ConnectionMetadataState> {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const identity = JSON.stringify([...new Set(connectionIDs)]);
  const store = useMemo(() => createConnectionsStore(pluginID, identity), [pluginID, identity]);
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}

function createSelectorStore<T>(pluginID: string, connectionID: string | undefined, selector: (state: ConnectionMetadataState) => T) {
  let previous: ConnectionMetadataState | undefined;
  let selected: T;
  return {
    read() {
      const state = connectionID === undefined ? empty : getCache(pluginID, connectionID).state;
      if (previous !== state) {
        selected = selector(state);
        previous = state;
      }
      return selected;
    },
  };
}

/** Select shared state with Object.is equality; unrelated entry changes do not rerender consumers. */
export function useConnectionMetadataSelector<T>(
  explicitPluginID: string | undefined,
  connectionID: string | undefined,
  selector: (state: ConnectionMetadataState) => T,
): T {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const listen = useCallback((listener: () => void) => connectionID === undefined ? () => {} : subscribe(getCache(pluginID, connectionID), listener), [pluginID, connectionID]);
  const store = useMemo(() => createSelectorStore(pluginID, connectionID, selector), [pluginID, connectionID, selector]);
  return useSyncExternalStore(listen, store.read, store.read);
}
