import { HOST_SOURCE, type ActivityProgress, type ActivityRecordLike, type ActivitySeverity, type SourceResolver, type TaskState } from '../activity';

// What the tests of the Operations tool build records and names with: invented plugins and tasks, and a resolver whose answers a test changes (and whose asks it counts). Nothing here is read by the tool.

/** The instant the tests count from: the host first had the records at T0 plus their own offset. */
export const T0 = Date.UTC(2026, 10, 24, 10, 0, 0);

/** An RFC 3339 stamp `seconds` after `T0`, as the host writes `createdAt`. */
export const stamp = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

export type Cancellation = 'unsupported' | 'available' | 'requested' | 'acknowledged';

export type TaskOptions = {
  readonly title?: string;
  readonly state?: TaskState;
  readonly cancellation?: Cancellation;
  readonly severity?: ActivitySeverity;
  readonly read?: boolean;
  /** Seconds after `T0`: when the host first had the record. */
  readonly at?: number;
  /** An explicit `createdAt`, for a spelling `at` cannot make (an offset, a stamp that is not one). */
  readonly createdAt?: string;
  readonly source?: ActivityRecordLike['source'];
  readonly message?: string;
  readonly progress?: ActivityProgress;
};

/** A task record of the host's activity service, running, with no cancellation and nothing read, unless the options say otherwise. */
export function task(id: string, options: TaskOptions = {}): ActivityRecordLike {
  const { title = `Task ${id}`, state = 'running', cancellation = 'unsupported', severity = 'info', read = false, at = 0, createdAt = stamp(at), source = { pluginID: 'alpha' }, message, progress } = options;
  return {
    id,
    kind: 'task',
    severity,
    createdAt,
    source,
    presentation: { title, message, progress },
    task: { state, cancellation },
    visibility: { read },
  };
}

/** A record of a kind that is not an operation: an alert and a message have their own tools. */
export const other = (id: string, kind: 'alert' | 'message'): ActivityRecordLike => ({ ...task(id), kind, task: undefined });

export const units = (current: string, total: string, unit: string): ActivityProgress => ({ kind: 'units', current, total, unit });

/** A record that says the same, as a new object. */
export const copy = (record: ActivityRecordLike): ActivityRecordLike => ({ ...record, presentation: { ...record.presentation }, source: { ...record.source }, visibility: { ...record.visibility } });

/** What the window knows of plugins and connections, which a test changes. Every ask is counted. */
export function names() {
  const plugins: Record<string, string> = { alpha: 'Alpha Cloud', beta: 'Beta Works' };
  const connections: Record<string, string> = { 'alpha/c-1': 'north' };
  const asked = { plugin: 0, connection: 0 };
  const resolve: SourceResolver = {
    plugin: (id) => {
      asked.plugin += 1;
      return id === undefined ? { id: HOST_SOURCE, name: 'Omniview' } : { id, name: plugins[id] ?? id };
    },
    connection: (plugin, key) => {
      asked.connection += 1;
      return connections[`${plugin}/${key}`];
    },
  };
  return { plugins, connections, resolve, asked };
}
