import { describe, expect, it, vi } from 'vitest';
import { ActivityStore, connectActivityStore } from './store';
import type { ActivityRecord, ActivityChange, ActivitySnapshot } from './types';

function record(
  id: string,
  revision: number,
  state: 'running' | 'succeeded' = 'running',
): ActivityRecord {
  return {
    id,
    revision,
    kind: 'task',
    severity: 'info',
    source: {},
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
    presentation: { title: id },
    task: { state, cancellation: 'available' },
    visibility: { collapsed: false, toastDismissed: false, read: false },
  };
}

describe('revisioned activity read model', () => {
  it('merges hydration without rolling back newer records or removals', () => {
    const store = new ActivityStore();
    store.applyChange({ revision: 6, record: record('task', 6, 'succeeded') });
    store.applyChange({ revision: 7, removedIds: ['removed'] });
    store.applySnapshot({ revision: 5, records: [record('task', 5), record('removed', 4)] });
    expect(store.getSnapshot().records.map((item) => [item.id, item.revision])).toEqual([
      ['task', 6],
    ]);
    store.applyChange({ revision: 3, record: record('stale', 3) });
    store.applyChange({ revision: 6, record: record('removed', 6) });
    expect(store.getSnapshot().records).toHaveLength(1);
  });

  it('treats snapshot absence as a tombstone and never replays stale snapshots', () => {
    const store = new ActivityStore();
    store.applyRecord(record('gone', 2));
    store.applySnapshot({ revision: 5, records: [] });
    store.applySnapshot({ revision: 3, records: [record('gone', 2)] });
    store.applyChange({ revision: 4, record: record('gone', 4) });
    expect(store.getSnapshot().records).toEqual([]);
  });

  it('accepts independent out-of-order events without losing unaffected records', () => {
    const store = new ActivityStore();
    store.applyRecord(record('new', 9));
    store.applyRecord(record('other', 8));
    store.applyChange({ revision: 7, removedIds: ['new'] });
    expect(store.getSnapshot().records).toHaveLength(2);
  });

  it('keeps every displayed active row pinned after completion until center closes', () => {
    const store = new ActivityStore();
    store.openNotifications('active');
    store.applyRecord(record('late', 1));
    store.applyRecord(record('late', 2, 'succeeded'));
    expect(store.getSnapshot().pinnedIds.has('late')).toBe(true);
    store.closeNotifications();
    expect(store.getSnapshot().pinnedIds.size).toBe(0);
  });

  it('registers listener before arming and reconciles events racing the Attach response', async () => {
    const store = new ActivityStore();
    const order: string[] = [];
    let listener!: (change: ActivityChange) => void;
    const attachment = Promise.withResolvers<ActivitySnapshot>();
    const stop = vi.fn();
    const client = {
      subscribe: vi.fn().mockResolvedValue({ id: 'view', snapshot: { revision: 0, records: [] } }),
      listen: (_id: string, apply: (change: ActivityChange) => void) => {
        order.push('listen');
        listener = apply;
        return stop;
      },
      attach: vi.fn().mockImplementation(() => {
        order.push('attach');
        return attachment.promise;
      }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AbortController();
    const connection = connectActivityStore(store, client, controller.signal);
    await Promise.resolve();
    listener({ revision: 2, record: record('task', 2, 'succeeded') });
    attachment.resolve({ revision: 1, records: [record('task', 1)] });
    await connection;
    expect(order).toEqual(['listen', 'attach']);
    expect(store.getSnapshot().records[0].task?.state).toBe('succeeded');
    controller.abort();
    expect(stop).toHaveBeenCalledOnce();
    expect(client.unsubscribe).toHaveBeenCalledWith('view');
  });
});
