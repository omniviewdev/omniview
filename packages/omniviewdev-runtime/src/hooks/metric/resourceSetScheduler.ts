import type { ResourceSetQueryResponse } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { ResourceSetQueryRequest, MetricResource } from '../../metric';

export interface ResourceSetSnapshot {
  data?: ResourceSetQueryResponse;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
}
export interface ResourceSetSubscription {
  snapshot: () => ResourceSetSnapshot;
  refetch: () => void;
  unsubscribe: () => void;
}
type Task = Promise<ResourceSetQueryResponse | null> & { cancel?: () => void };
type Execute = (request: ResourceSetQueryRequest) => Task;
type Entry = { resource: MetricResource; data?: ResourceSetQueryResponse; error: Error | null; at: number; task?: Task };
type Consumer = { keys: string[]; interval: number; notify: () => void };
type Group = { request: ResourceSetQueryRequest; entries: Map<string, Entry>; consumers: Set<Consumer>; timer?: ReturnType<typeof setTimeout>; generation: number };

/** Stable structural keys include public projection, canonical route and provider scope. */
export function metricRequestKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/**
 * Shares scheduling across consumers: 128 scopes, 512 retained resources per scope,
 * 128 resources per execution, and four global flights. Overflow fails explicitly.
 */
export class ResourceSetScheduler {
  private groups = new Map<string, Group>();
  private inFlight = 0;
  constructor(private execute: Execute, private now = Date.now) {}

  subscribe(request: ResourceSetQueryRequest, interval: number, notify: () => void): ResourceSetSubscription {
    const { resources, ...scope } = request;
    if (resources.length > 512) throw new RangeError('Metric subscription exceeds 512 resources');
    const resourceKeys = resources.map(resource => metricRequestKey(resource));
    const key = metricRequestKey(scope);
    let group = this.groups.get(key);
    if (!group) {
      if (this.groups.size >= 128) throw new RangeError('Metric scheduler exceeds 128 retained scopes');
      group = { request, entries: new Map(), consumers: new Set(), generation: 0 };
      this.groups.set(key, group);
    }
    const current = group;
    const retained = new Set([...current.entries.keys(), ...resourceKeys]);
    if (retained.size > 512) {
      const active = new Set([...current.consumers].flatMap(consumer => consumer.keys));
      for (const k of current.entries.keys()) if (!active.has(k) && !resourceKeys.includes(k) && !current.entries.get(k)!.task) {
        current.entries.delete(k);
        retained.delete(k);
      }
      if (retained.size > 512) throw new RangeError('Metric scope exceeds 512 retained resources');
    }
    const keys = resources.map(resource => {
      const resourceKey = metricRequestKey(resource);
      if (!current.entries.has(resourceKey)) current.entries.set(resourceKey, { resource, error: null, at: 0 });
      const entry = current.entries.get(resourceKey)!;
      if (!entry.task && this.now() - entry.at >= 5000) entry.at = 0;
      return resourceKey;
    });
    const consumer: Consumer = { keys, interval: Number.isFinite(interval) && interval > 0 ? Math.max(100, interval) : 0, notify };
    current.consumers.add(consumer);
    this.schedule(current, key, 8);
    return {
      snapshot: (): ResourceSetSnapshot => {
        const entries = keys.map(k => current.entries.get(k)!);
        const ready = entries.every(entry => entry.data !== undefined);
        return {
          data: ready ? { results: entries.flatMap(entry => entry.data!.results ?? []), warnings: [...new Set(entries.flatMap(entry => entry.data!.warnings ?? []))] } as ResourceSetQueryResponse : undefined,
          error: entries.find(entry => entry.error)?.error ?? null,
          isLoading: !ready && entries.some(entry => !entry.error),
          isFetching: entries.some(entry => !!entry.task),
        };
      },
      refetch: () => {
        for (const k of keys) current.entries.get(k)!.at = 0;
        this.schedule(current, key, 0);
      },
      unsubscribe: () => {
        current.consumers.delete(consumer);
        const active = new Set([...current.consumers].flatMap(item => item.keys));
        const tasks = new Set([...current.entries.values()].map(entry => entry.task).filter((task): task is Task => !!task));
        for (const task of tasks) {
          if (![...active].some(k => current.entries.get(k)?.task === task)) {
            for (const entry of current.entries.values()) if (entry.task === task) entry.task = undefined;
            task.cancel?.();
          }
        }
        if (!current.consumers.size) {
          current.generation++;
          this.schedule(current, key, 5000);
        }
      },
    };
  }

  private schedule(group: Group, key: string, delay: number) {
    clearTimeout(group.timer);
    group.timer = setTimeout(() => { group.timer = undefined; this.flush(group, key); }, delay);
  }

  private flush(group: Group, key: string) {
    if (!group.consumers.size) { this.groups.delete(key); return; }
    const active = new Map<string, number>();
    for (const consumer of group.consumers) for (const k of consumer.keys) {
      active.set(k, Math.min(active.get(k) ?? Infinity, consumer.interval || Infinity));
    }
    const due: Entry[] = [];
    for (const [k, interval] of active) {
      const entry = group.entries.get(k)!;
      if (!entry.task && (!entry.at || this.now() - entry.at >= Math.min(interval, entry.data ? Infinity : 5000))) due.push(entry);
    }
    // Prune detached resource projections while keeping a short cache for a reopened sidebar.
    for (const [k, entry] of group.entries) if (!active.has(k) && !entry.task && this.now() - entry.at >= 5000) group.entries.delete(k);
    const chunks: Entry[][] = [];
    for (const entry of due) {
      let chunk = chunks.find(items => items.length < 128 && !items.some(item => item.resource.token === entry.resource.token));
      if (!chunk) { chunk = []; chunks.push(chunk); }
      chunk.push(entry);
    }
    for (const chunk of chunks) {
      if (this.inFlight >= 4) { this.schedule(group, key, 100); break; }
      this.inFlight++;
      const generation = group.generation;
      let task: Task;
      try { task = this.execute({ ...group.request, resources: chunk.map(entry => entry.resource) } as ResourceSetQueryRequest); }
      catch (error) { task = Promise.reject(error); }
      for (const entry of chunk) entry.task = task;
      void task.then(response => {
        if (!response) throw new Error('Metric provider returned no resource-set response');
        for (const entry of chunk) if (group.generation === generation && entry.task === task) {
          entry.data = { results: (response.results ?? []).filter(result => result.resource_token === entry.resource.token), warnings: response.warnings ?? [] } as ResourceSetQueryResponse;
          entry.error = null;
        }
      }).catch(error => {
        for (const entry of chunk) if (group.generation === generation && entry.task === task) entry.error = error instanceof Error ? error : new Error(String(error));
      }).finally(() => {
        this.inFlight--;
        for (const entry of chunk) if (group.generation === generation && entry.task === task) { entry.task = undefined; entry.at = this.now(); }
        if (group.generation !== generation) return;
        for (const consumer of group.consumers) consumer.notify();
        this.schedule(group, key, 8);
      });
    }
    for (const consumer of group.consumers) consumer.notify();
    if (!due.length) {
      let delay = Infinity;
      for (const [k, interval] of active) {
        const entry = group.entries.get(k)!;
        if (!entry.task) delay = Math.min(delay, Math.max(8, entry.at + (entry.data ? interval : Math.min(interval, 5000)) - this.now()));
      }
      if (Number.isFinite(delay)) this.schedule(group, key, delay);
    }
  }
}
