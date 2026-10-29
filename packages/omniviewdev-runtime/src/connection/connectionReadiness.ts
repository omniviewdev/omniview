import { Events } from '@wailsio/runtime';
import {
  CheckConnection,
  StartConnection,
  StopConnection,
} from '../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import type { Connection, ConnectionStatus } from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { parseAppError } from '../errors/parseAppError';

export type ConnectionReadinessPhase =
  | 'checking' | 'disconnected' | 'connecting' | 'connected'
  | 'unauthorized' | 'forbidden' | 'not-found' | 'error';

export interface ConnectionReadiness {
  phase: ConnectionReadinessPhase;
  message?: string;
  connection?: Connection;
  connect: () => Promise<void>;
  retry: () => Promise<void>;
}

type Snapshot = Pick<ConnectionReadiness, 'phase' | 'message' | 'connection'>;
type Operation = { kind: 'check' | 'start'; promise: Promise<ConnectionStatus>; version: number };
type Entry = {
  pluginID: string;
  connectionID: string;
  key: string;
  snapshot: Snapshot;
  listeners: Set<() => void>;
  users: number;
  version: number;
  generation: number;
  operation?: Operation;
  starts: Set<number>;
  stop?: Promise<Connection>;
};

// JSON tuples keep plugin IDs and opaque connection IDs separate, including slashes.
const entries = new Map<string, Entry>();
const unavailablePlugins = new Map<string, string>();
let activeUsers = 0;
let cancelEvents: (() => void)[] = [];
let generation = 0;
const checking: Snapshot = { phase: 'checking' };

function getEntry(pluginID: string, connectionID: string): Entry {
  const key = JSON.stringify([pluginID, connectionID]);
  let entry = entries.get(key);
  if (!entry) {
    entry = { pluginID, connectionID, key, snapshot: checking, listeners: new Set(), users: 0, version: 0, generation: ++generation, starts: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, snapshot: Snapshot) {
  if (entry.snapshot.phase === 'connected' && snapshot.phase !== 'connected') entry.generation = ++generation;
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

function invalidate(entry: Entry, snapshot: Snapshot, preserveOperation = false) {
  entry.generation = ++generation;
  entry.version++;
  if (!preserveOperation) entry.operation = undefined;
  publish(entry, snapshot);
}

function phaseForStatus(status: string): ConnectionReadinessPhase {
  switch (status) {
    case 'CONNECTED': return 'connected';
    case 'DISCONNECTED': return 'disconnected';
    case 'PENDING': return 'connecting';
    case 'UNAUTHORIZED': return 'unauthorized';
    case 'FORBIDDEN': return 'forbidden';
    case 'NOT_FOUND': return 'not-found';
    default: return 'error';
  }
}

function safeMessage(value?: string): string | undefined {
  const message = value?.trim();
  if (!message) return undefined;
  if (message.startsWith('{') || message.startsWith('[')) return 'The connection operation could not be completed.';
  if (message.length > 512 || /[\r\n]|\bgoroutine\b|\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(message)) {
    return 'The connection operation could not be completed.';
  }
  return message;
}

function statusSnapshot(status: Pick<ConnectionStatus, 'status' | 'error' | 'details'>, connection?: Connection): Snapshot {
  const phase = phaseForStatus(status.status);
  return {
    phase,
    connection,
    message: safeMessage(status.error || status.details) || (phase === 'error' ? 'The connection is not ready.' : undefined),
  };
}

function failureSnapshot(error: unknown, connection?: Connection): Snapshot {
  const parsed = parseAppError(error);
  const phase = parsed.status === 401 ? 'unauthorized'
    : parsed.status === 403 ? 'forbidden'
      : parsed.status === 404 ? 'not-found' : 'error';
  return { phase, connection, message: safeMessage(parsed.detail || parsed.title) };
}

function invalidatePlugin(pluginID: string, message: string) {
  message = safeMessage(message) || 'The plugin is unavailable.';
  unavailablePlugins.set(pluginID, message);
  for (const entry of entries.values()) {
    if (entry.pluginID === pluginID) {
      invalidate(entry, { phase: 'error', message, connection: entry.snapshot.connection });
    }
  }
}

function recoverPlugin(pluginID: string) {
  const wasUnavailable = unavailablePlugins.delete(pluginID);
  for (const entry of entries.values()) {
    if (entry.pluginID !== pluginID) continue;
    if (!wasUnavailable && entry.snapshot.phase === 'checking' && entry.operation?.kind === 'check') continue;
    invalidate(entry, { phase: 'checking', connection: entry.snapshot.connection });
    if (entry.users) void run(entry, 'check').catch(() => {});
  }
}

function recheckActive() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  for (const entry of entries.values()) {
    if (entry.users && !unavailablePlugins.has(entry.pluginID)) {
      void run(entry, 'check', true).catch(() => {});
    }
  }
}

function listen() {
  if (cancelEvents.length) return;
  cancelEvents = [
    Events.On('connection/status', ({ data }) => {
      const entry = entries.get(JSON.stringify([data.pluginID, data.connectionID]));
      if (!entry || unavailablePlugins.has(data.pluginID)) return;
      if (entry.stop && data.status !== 'DISCONNECTED') return;
      // An invalidated start can still emit its final event before its RPC settles.
      if (data.status !== 'DISCONNECTED' && entry.starts.size && entry.operation?.kind !== 'start') return;
      // Events outrank responses from checks/starts that began before this event.
      invalidate(entry, statusSnapshot({ status: data.status as ConnectionStatus['status'], error: '', details: '' }, entry.snapshot.connection), data.status === 'CONNECTED');
    }),
    Events.On('plugin/crash', ({ data }) => invalidatePlugin(data.pluginID, data.error || 'The plugin stopped unexpectedly.')),
    Events.On('plugin/crash_recovery_failed', ({ data }) => invalidatePlugin(data.pluginID, data.error || 'Plugin recovery failed.')),
    Events.On('plugin/recovered', ({ data }) => recoverPlugin(data.pluginID)),
    Events.On('plugin/state_change', ({ data }) => {
      if (data.to === 'Running') recoverPlugin(data.pluginID);
      else invalidatePlugin(data.pluginID, data.reason || `The plugin is ${data.to}.`);
    }),
  ];
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', recheckActive);
    window.addEventListener('pageshow', recheckActive);
    cancelEvents.push(() => {
      window.removeEventListener('focus', recheckActive);
      window.removeEventListener('pageshow', recheckActive);
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', recheckActive);
    cancelEvents.push(() => document.removeEventListener('visibilitychange', recheckActive));
  }
}

function retain(entry: Entry) {
  entries.set(entry.key, entry);
  entry.users++;
  activeUsers++;
  listen();
  return () => {
    entry.users--;
    activeUsers--;
    if (!entry.users) {
      invalidate(entry, checking);
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
    }
    if (!activeUsers) {
      for (const cancel of cancelEvents) cancel();
      cancelEvents = [];
      unavailablePlugins.clear();
    }
  };
}

function run(entry: Entry, kind: Operation['kind'], background = false): Promise<ConnectionStatus> {
  if (entry.stop) return Promise.reject(new Error('Connection is disconnecting. Wait for it to stop before connecting.'));
  const unavailable = unavailablePlugins.get(entry.pluginID);
  if (unavailable) {
    publish(entry, { phase: 'error', message: unavailable, connection: entry.snapshot.connection });
    return Promise.reject(new Error(unavailable));
  }
  // Checks also join an explicit start. Explicit starts supersede existing checks.
  if (entry.operation && (kind === 'check' || entry.operation.kind === 'start')) return entry.operation.promise;
  const version = ++entry.version;
  if (!background || entry.snapshot.phase !== 'connected') {
    publish(entry, { phase: kind === 'start' ? 'connecting' : 'checking', connection: entry.snapshot.connection });
  }
  if (kind === 'start') entry.starts.add(version);
  const promise = Promise.resolve().then(() => {
    if (entry.version !== version) throw new Error('Connection readiness changed before the operation began.');
    return kind === 'start'
      ? StartConnection(entry.pluginID, entry.connectionID)
      : CheckConnection(entry.pluginID, entry.connectionID);
  })
    .then((status) => {
      if (entry.version === version) publish(entry, statusSnapshot(status, status.connection ?? entry.snapshot.connection));
      return status;
    }, (error: unknown) => {
      if (entry.version === version) publish(entry, failureSnapshot(error, entry.snapshot.connection));
      throw error;
    })
    .finally(() => {
      if (kind === 'start') entry.starts.delete(version);
      if (entry.operation?.version === version) entry.operation = undefined;
    });
  entry.operation = { kind, promise, version };
  return promise;
}

/** Internal hook adapter. Inactive snapshots never reuse an earlier mount's readiness. */
export function connectionReadinessStore(pluginID: string, connectionID: string) {
  return {
    getSnapshot: () => getEntry(pluginID, connectionID).snapshot,
    subscribe: (listener: () => void) => {
      const entry = getEntry(pluginID, connectionID);
      const first = entry.users === 0;
      const release = retain(entry);
      entry.listeners.add(listener);
      if (first) void run(entry, 'check').catch(() => {});
      return () => {
        entry.listeners.delete(listener);
        release();
      };
    },
    connect: async () => {
      const entry = getEntry(pluginID, connectionID);
      const release = retain(entry);
      try { await run(entry, 'start'); } catch { /* Failure is exposed through the snapshot. */ }
      finally { release(); }
    },
    retry: async () => {
      const entry = getEntry(pluginID, connectionID);
      const release = retain(entry);
      try { await run(entry, 'check'); } catch { /* Failure is exposed through the snapshot. */ }
      finally { release(); }
    },
  };
}

/** Check connection readiness before non-React I/O. This never starts a connection. */
export async function requireConnectionReady(pluginID: string, connectionID: string): Promise<void> {
  const entry = getEntry(pluginID, connectionID);
  const release = retain(entry);
  try {
    try { await run(entry, 'check', true); } catch { /* Use the same classified state as the UI. */ }
    if (entry.snapshot.phase !== 'connected') {
      throw new Error(entry.snapshot.message || `Connection ${connectionID} is ${entry.snapshot.phase}. Connect before continuing.`);
    }
  } finally { release(); }
}

/** Keep lifecycle events observed until I/O completes, then reject invalidated results. */
export async function withConnectionReady<T>(
  pluginID: string,
  connectionID: string,
  operation: () => Promise<T>,
): Promise<T> {
  const entry = getEntry(pluginID, connectionID);
  const release = retain(entry);
  try {
    try { await run(entry, 'check', true); } catch { /* Classify only connection-level check errors. */ }
    if (entry.snapshot.phase !== 'connected') {
      throw new Error(entry.snapshot.message || `Connection ${connectionID} is ${entry.snapshot.phase}. Connect before continuing.`);
    }
    const startedGeneration = entry.generation;
    const result = await operation();
    if (entry.generation !== startedGeneration || entry.snapshot.phase !== 'connected') {
      throw new Error(`Connection ${connectionID} changed while the operation was in progress. Retry after connecting.`);
    }
    return result;
  } finally { release(); }
}

/** Internal resource-I/O fence; reading does not create or retain a store entry. */
export function getConnectionReadinessGeneration(pluginID: string, connectionID: string): number | undefined {
  return entries.get(JSON.stringify([pluginID, connectionID]))?.generation;
}

export function isConnectionReadinessCurrent(pluginID: string, connectionID: string, expectedGeneration: number | undefined): boolean {
  const entry = entries.get(JSON.stringify([pluginID, connectionID]));
  return expectedGeneration !== undefined && entry?.generation === expectedGeneration && entry.snapshot.phase === 'connected';
}

/** Preserve useConnection's status return value while sharing explicit starts. */
export async function startConnectionWithReadiness(pluginID: string, connectionID: string): Promise<ConnectionStatus> {
  const entry = getEntry(pluginID, connectionID);
  const release = retain(entry);
  try { return await run(entry, 'start'); }
  finally { release(); }
}

/** Block consumers immediately, including while a previous check/start is pending. */
export function stopConnectionWithReadiness(pluginID: string, connectionID: string): Promise<Connection> {
  const entry = getEntry(pluginID, connectionID);
  if (entry.stop) return entry.stop;
  const release = retain(entry);
  const stop = Promise.resolve().then(() => StopConnection(pluginID, connectionID)).then(
    (connection) => {
      invalidate(entry, { phase: 'disconnected', connection });
      return connection;
    },
    (error: unknown) => {
      invalidate(entry, failureSnapshot(error, entry.snapshot.connection));
      throw error;
    },
  ).finally(() => {
    entry.stop = undefined;
    release();
  });
  entry.stop = stop;
  invalidate(entry, { phase: 'disconnected', message: 'Disconnecting. Wait for the connection to stop before reconnecting.', connection: entry.snapshot.connection });
  return stop;
}

export function invalidateConnectionReadiness(pluginID: string, connectionID: string, removed = false) {
  const entry = entries.get(JSON.stringify([pluginID, connectionID]));
  if (!entry) return;
  invalidate(entry, { phase: removed ? 'not-found' : 'checking', connection: removed ? undefined : entry.snapshot.connection });
  if (!removed && entry.users) void run(entry, 'check').catch(() => {});
}
