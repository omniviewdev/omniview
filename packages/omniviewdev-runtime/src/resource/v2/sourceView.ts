import { Events } from '@wailsio/runtime';
import { CloseSourceView, OpenSourceView, RefreshSourceView, SyncSourceView } from './client';
import type { HostRecord, HostSourceStatus, HostSourceViewEvent, HostSourceViewOpened, HostSourceViewRequest } from './host';

export interface SourceViewSnapshot {
  viewGeneration?: string;
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

export async function openSourceView(pluginID: string, request: HostSourceViewRequest): Promise<SourceViewClient> {
  const opened = await OpenSourceView(pluginID, request);
  let snapshot: SourceViewSnapshot = { records: new Map(), complete: false };
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
      case 'snapshotEnd':
        if (!staging || !event.status) { resync(); return; }
        update({ records: staging, viewGeneration: generation, status: event.status, complete: true }, 'snapshotEnd');
        staging = undefined;
        break;
      case 'changes': {
        if (staging) { resync(); return; }
        const records = new Map(snapshot.records);
        for (const removal of event.removes ?? []) records.delete(removal.key);
        for (const record of event.upserts ?? []) records.set(record.key, record);
        update({ records }, 'changes');
        break;
      }
      case 'status':
        if (staging || !event.status) { resync(); return; }
        update({ status: event.status });
        break;
      default:
        resync();
    }
  }

  const unsubscribe = Events.On(opened.topic, event => accept(event.data as HostSourceViewEvent));
  const client: SourceViewClient = {
    mode: opened.mode,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return snapshot; },
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
