import { replaceEqualDeep } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { CloseSourceView, OpenSourceView, RefreshSourceView, SyncSourceView } from './client';
import type { HostRecord, HostRecordRemoval, HostSourceStatus, HostSourceViewEvent, HostSourceViewOpened, HostSourceViewRequest } from './host';

export interface SourceViewSnapshot {
  viewGeneration?: string;
  /**
   * Current records by host key. A map handed out here is never modified afterwards. A record that a
   * later snapshot repeats unchanged is the same object, so a reader can tell which records moved.
   */
  records: ReadonlyMap<string, HostRecord>;
  status?: HostSourceStatus;
  complete: boolean;
  /** Changes relevant to consumers that invalidate derived caches. */
  event?: { kind: 'snapshotEnd' | 'changes' | 'reset'; revision: number };
}

export interface SourceViewClient {
  readonly mode: HostSourceViewOpened['mode'];
  subscribe(listener: () => void): () => void;
  getSnapshot(): SourceViewSnapshot;
  refresh(): Promise<void>;
  close(): void;
}

const openViews = new Set<SourceViewClient>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const view of openViews) view.close();
  });
}

/**
 * Open a host source view, attach its event listener, and request initial synchronization.
 * Resolves with a client before the initial snapshot necessarily completes; callers subscribe
 * to subsequent snapshots and must close the client when finished. Notifications are coalesced.
 * Open and initial synchronization errors reject the promise; an initial synchronization failure
 * also closes the client. Later resynchronization failures become failed snapshot status.
 */
export async function openSourceView(pluginID: string, request: HostSourceViewRequest): Promise<SourceViewClient> {
  const opened = await OpenSourceView(pluginID, request);
  let snapshot: SourceViewSnapshot = { records: new Map(), complete: false };
  /** The current records while no reader has received them yet: the only map a patch may edit in place. */
  let writable: Map<string, HostRecord> | undefined;
  let staging: Map<string, HostRecord> | undefined;
  let generation: string | undefined;
  let rejectedGeneration: string | undefined;
  let sequence = BigInt(0);
  let awaitingGeneration = true;
  let closed = false;
  let failed = false;
  let revision = 0;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts: number[] = [];
  const listeners = new Set<() => void>();

  function notify() {
    if (frame !== undefined || timer !== undefined || closed) return;
    const deliver = () => {
      frame = undefined;
      timer = undefined;
      if (!closed) for (const listener of listeners) listener();
    };
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(deliver);
    else timer = setTimeout(deliver, 0);
  }

  function update(patch: Partial<SourceViewSnapshot>, kind?: 'snapshotEnd' | 'changes' | 'reset') {
    snapshot = { ...snapshot, ...patch, ...(kind ? { event: { kind, revision: ++revision } } : {}) };
    notify();
  }

  function fail(message: string) {
    if (closed || failed) return;
    failed = true;
    update({ status: {
      ...snapshot.status,
      state: 'failed',
      mode: snapshot.status?.mode ?? opened.mode,
      count: snapshot.status?.count ?? { kind: 'exact', value: String(snapshot.records.size) },
      error: { code: 'sourceViewSyncFailed', title: 'Source view synchronization failed', message },
    } });
  }

  function resync() {
    if (closed || failed) return;
    staging = undefined;
    awaitingGeneration = true;
    const now = Date.now();
    attempts = attempts.filter(time => now - time < 10_000);
    if (attempts.length >= 3) {
      fail('Source view could not maintain a contiguous event sequence.');
      return;
    }
    attempts.push(now);
    void SyncSourceView(pluginID, opened.viewId).catch(error => fail(String(error)));
  }

  /**
   * Apply one patch by host key. A record the patch repeats unchanged keeps its object, and a patch that
   * changes nothing keeps the map itself. A map a reader has received is never modified: the first change
   * after a read copies it once, and the patches that follow before the next read edit that copy.
   */
  function applyChanges(removes: readonly HostRecordRemoval[], upserts: readonly HostRecord[]): ReadonlyMap<string, HostRecord> {
    let draft = writable;
    for (const removal of removes) {
      if ((draft ?? snapshot.records).has(removal.key)) (draft ??= new Map(snapshot.records)).delete(removal.key);
    }
    for (const record of upserts) {
      const held = (draft ?? snapshot.records).get(record.key);
      const shared = held === undefined ? record : replaceEqualDeep(held, record);
      if (shared !== held) (draft ??= new Map(snapshot.records)).set(record.key, shared);
    }
    writable = draft;
    return draft ?? snapshot.records;
  }

  function accept(event: HostSourceViewEvent) {
    if (closed || failed || event.viewId !== opened.viewId) return;
    // Reset is a control event: overflow can discard events preceding it.
    if (event.kind === 'reset') {
      staging = undefined;
      awaitingGeneration = true;
      update({}, 'reset');
      if (event.reset?.reason === 'closed') {
        update({ status: { ...snapshot.status, state: 'closed', mode: snapshot.status?.mode ?? opened.mode,
          count: snapshot.status?.count ?? { kind: 'exact', value: String(snapshot.records.size) } } });
      }
      return;
    }
    if (awaitingGeneration) {
      if ((event.kind !== 'snapshot' && event.kind !== 'snapshotEnd') || event.sequence !== '1' ||
          !event.viewGeneration || event.viewGeneration === generation || event.viewGeneration === rejectedGeneration) return;
      generation = event.viewGeneration;
      rejectedGeneration = undefined;
      sequence = BigInt(0);
      staging = new Map();
      awaitingGeneration = false;
    }
    if (!/^[1-9][0-9]*$/.test(event.sequence)) { rejectedGeneration = event.viewGeneration; resync(); return; }
    const next = BigInt(event.sequence);
    if (event.viewGeneration !== generation || next !== sequence + BigInt(1)) {
      rejectedGeneration = event.viewGeneration;
      resync();
      return;
    }
    sequence = next;
    switch (event.kind) {
      case 'snapshot':
        if (!staging) { resync(); return; }
        for (const record of event.records ?? []) staging.set(record.key, record);
        break;
      case 'snapshotEnd': {
        if (!staging || !event.status) { resync(); return; }
        // A new generation repeats most of the records it replaces: those keep their objects.
        for (const [key, record] of staging) {
          const held = snapshot.records.get(key);
          if (held !== undefined) staging.set(key, replaceEqualDeep(held, record));
        }
        writable = staging;
        update({ records: staging, viewGeneration: generation, status: replaceEqualDeep(snapshot.status, event.status), complete: true }, 'snapshotEnd');
        staging = undefined;
        break;
      }
      case 'changes':
        if (staging) { resync(); return; }
        update({ records: applyChanges(event.removes ?? [], event.upserts ?? []) }, 'changes');
        break;
      case 'status': {
        if (staging || !event.status) { resync(); return; }
        const status = replaceEqualDeep(snapshot.status, event.status);
        if (status !== snapshot.status) update({ status });
        break;
      }
      default:
        resync();
    }
  }

  const unsubscribe = Events.On(opened.topic, event => accept(event.data as HostSourceViewEvent));
  const client: SourceViewClient = {
    mode: opened.mode,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Return the current snapshot, preserving its records map against subsequent patches. */
    getSnapshot() {
      writable = undefined;
      return snapshot;
    },
    async refresh() {
      const wasFailed = failed;
      failed = false;
      attempts = [];
      try {
        await RefreshSourceView(pluginID, opened.viewId);
      } catch (error) {
        failed = wasFailed;
        throw error;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      openViews.delete(client);
      unsubscribe();
      if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      clearTimeout(timer);
      listeners.clear();
      void CloseSourceView(pluginID, opened.viewId).catch(() => {});
    },
  };
  openViews.add(client);
  try {
    await SyncSourceView(pluginID, opened.viewId);
  } catch (error) {
    client.close();
    throw error;
  }
  return client;
}
