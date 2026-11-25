import type { Subject } from './subject';

// What the Problems and Operations tools read of the host's activity service (`backend/pkg/activity`, observed in the window by the runtime's `ActivityProvider`): its records, the two calls the tools make (cancel a task, mark a
// record read) and how a record's source names the thing a row is about. The records are the runtime's `ActivityRecord`, read structurally (only the members the tools use), so the tools import nothing of the runtime and a test
// builds a record in a few lines. One feed serves both tools: the window's one subscription to the activity service (each is a producer lease) is the runtime provider's, and the feed is how the host hands its records over, and
// what it says when it could not read them: a failed observation and an observation of no activity both hold no record, and the tools must not draw them alike.

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error';

export type TaskState = 'starting' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/** The producer's own progress: a count the producer says (strings: canonical decimals, which never pass through a double), or steps, or no measure at all. */
export type ActivityProgress =
  | { readonly kind: 'indeterminate'; readonly message?: string | undefined }
  | { readonly kind: 'units'; readonly current: string; readonly total: string; readonly unit: string }
  | { readonly kind: 'steps'; readonly current: string; readonly total: string; readonly label: string };

export type ActivityRecordLike = {
  readonly id: string;
  readonly kind: 'task' | 'alert' | 'message';
  readonly severity: ActivitySeverity;
  /** RFC 3339: when the host first had the record. */
  readonly createdAt: string;
  readonly source: { readonly pluginID?: string | undefined; readonly connectionID?: string | undefined };
  readonly presentation: { readonly title: string; readonly message?: string | undefined; readonly progress?: ActivityProgress | undefined };
  readonly task?: { readonly state: TaskState; readonly cancellation: 'unsupported' | 'available' | 'requested' | 'acknowledged'; readonly unknownReason?: string | undefined } | undefined;
  readonly alert?: { readonly key: string; readonly state: 'firing' | 'resolved' | 'unknown'; readonly occurrences: number } | undefined;
  readonly visibility: { readonly read: boolean };
};

/** The records as the window holds them, what a failed observation of the service says, and the two things a tool asks of the service. `getSnapshot` answers the same array until the records change. */
export type ActivityFeed = {
  readonly getSnapshot: () => readonly ActivityRecordLike[];
  /**
   * The sentence for a failed observation of the activity service (the provider could not read it), or `undefined` while it can be observed: the runtime provider's `unavailable`, never its wider `error`, which a notice that could not be
   * published sets too. Records held beside a sentence are what the window saw last, and stay: a tool lists them, and for none it says the service could not be read, never "no activity", which a read that failed does not mean.
   */
  readonly getError: () => string | undefined;
  /** Told when the records or the error change, once for each push. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Asks the host to stop a task (`RequestCancellation`): resolves with the host's answer, rejects with its error. */
  readonly cancel: (id: string) => Promise<unknown>;
  /** Marks a record read (`SetPresentation { read: true }`): the host keeps it, so every window and the next run agree. */
  readonly markRead: (id: string) => Promise<unknown>;
};

/** What a person reads for a plugin and for a connection, as the host knows them now: the tools never show an id or a key. */
export type SourceResolver = {
  /** The plugin as a person reads it: its name when the window knows it, else its id; a record with no plugin is the host's own work, `Omniview`. */
  readonly plugin: (id: string | undefined) => { readonly id: string; readonly name: string };
  /** What the connection is called, or `undefined` when the window does not know it (its plugin is not loaded, or the list has not been read). */
  readonly connection: (plugin: string, key: string) => string | undefined;
};

/** The id of the host's own work: a record that names no plugin. */
export const HOST_SOURCE = 'host';

/** Where a record's row goes: the connection it names when the window knows it, else its plugin; a record of the host's own work has no page. */
export function subjectOf(source: ActivityRecordLike['source'], resolve: SourceResolver): Subject | undefined {
  const { pluginID, connectionID } = source;
  if (pluginID === undefined || pluginID === '') {
    return undefined;
  }

  return connectionID !== undefined && resolve.connection(pluginID, connectionID) !== undefined ? { kind: 'connection', plugin: pluginID, connection: connectionID } : { kind: 'plugin', plugin: pluginID };
}

/** The feed the host hands both tools, and the way the window's activity provider feeds it. */
export type ActivityFeedControl = {
  readonly feed: ActivityFeed;
  /**
   * Gives the feed what the provider holds now: its records, and `unavailable`, the sentence for why it cannot observe the service right now. A push with no `unavailable` says the service can be observed, so it clears the one before.
   * Listeners hear of it only when the records are not the array the feed already has or the sentence is not the one it has, and once when both are new.
   */
  readonly push: (records: readonly ActivityRecordLike[], unavailable?: string) => void;
};

const NONE: readonly ActivityRecordLike[] = Object.freeze([]);

export function createActivityFeed(calls: Pick<ActivityFeed, 'cancel' | 'markRead'>): ActivityFeedControl {
  let records = NONE;
  let failure: string | undefined;
  const listeners = new Set<() => void>();
  return {
    feed: {
      getSnapshot: () => records,
      getError: () => failure,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      cancel: async (id) => calls.cancel(id),
      markRead: async (id) => calls.markRead(id),
    },
    push: (next, unavailable) => {
      if (next === records && unavailable === failure) {
        return;
      }

      records = next;
      failure = unavailable;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}
