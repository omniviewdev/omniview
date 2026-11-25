import { subjectOf, type ActivityRecordLike, type ActivitySeverity, type SourceResolver } from '../../shell/panel/activity';
import type { Condition, Severity } from '../../shell/panel/problems';
import { failureWords } from '../loader/failure';
import { faceOf, type ConnectionState, type ConnectionsState } from './connections';
import type { PluginEntry } from './pluginStore';

// The producers of the Problems tool that exist today, as the conditions they state (ch16 S74, S94, S121; docs/ui-next/status/PT1.md, section 3). Each is a pure function of what the window already holds: the host calls it
// whenever its source says it changed and gives the list to `problems.set(producer, list)`, which replaces what that producer said. The PRODUCER states the fact and these functions only word it, so nothing here guesses:
// a plugin that is starting again is not a problem (nothing failed), a connection that is not connected is not one either (disconnected is a normal idle state, S94), and an alert whose plugin stopped reporting is neither
// hidden nor claimed to be true. Keys are prefixed with the producer's own word, so two producers never say one key. The host knows no plugin: every name comes from the stores.

/**
 * The plugins the window could not keep running: the entries that are failed and whose failure `failureWords` says is a fault. A plugin that is `reloaded` is starting again, and one that is loading or ready has no
 * fault, so none of them is listed. The row is about the plugin and goes to its own page (the one that says what happened and offers the Retry).
 */
export function pluginConditions(entries: readonly PluginEntry[]): readonly Condition[] {
  const conditions: Condition[] = [];
  for (const entry of entries) {
    if (entry.phase !== 'failed') {
      continue;
    }

    const words = failureWords(entry.failure);
    if (!words.faulted) {
      continue;
    }

    conditions.push({
      key: `plugin:${entry.id}`,
      severity: 'error',
      label: words.caption,
      title: `${entry.name}: ${entry.failure.message}`,
      source: { id: entry.id, name: entry.name },
      target: entry.name,
      subject: { kind: 'plugin', plugin: entry.id },
    });
  }

  return conditions;
}

/**
 * How bad each state of a connection is. The three that are not a failure have none: `connected` is well, `connecting` is on its way, and `disconnected` is a normal idle state, never counted or shown as a problem (S94: "27
 * disconnected" was permanent noise). A start that needs the person to sign in is a warning, because only they can fix it and nothing is broken; the others are errors.
 */
const CONNECTION_SEVERITY: Readonly<Record<ConnectionState, Severity | undefined>> = {
  connected: undefined,
  connecting: undefined,
  disconnected: undefined,
  unauthorized: 'warning',
  forbidden: 'error',
  unreachable: 'error',
  failed: 'error',
};

/**
 * The connections whose start failed, by the class of the failure (the host's words: "Not responding", "Connection failed", "Access denied", "Needs sign-in"). The key is the pair of the plugin and the connection's key as one
 * JSON text, so a plugin id and a key that run together are still two conditions. The sentence is the connection's name and the host's one safe line about the failure, or the state's word when the host gave none. The row
 * is about the connection and goes to it, started the way Home and the picker start one.
 */
export function connectionConditions(state: ConnectionsState, pluginName: (id: string) => string): readonly Condition[] {
  const conditions: Condition[] = [];
  for (const connection of state.connections) {
    const severity = CONNECTION_SEVERITY[connection.state];
    if (severity === undefined) {
      continue;
    }

    const { word } = faceOf(connection.state);
    const reason = connection.reason?.trim();
    conditions.push({
      key: `connection:${JSON.stringify([connection.plugin, connection.key])}`,
      severity,
      label: word,
      title: `${connection.name}: ${reason === undefined || reason === '' ? word : reason}`,
      source: { id: connection.plugin, name: pluginName(connection.plugin) },
      target: connection.name,
      subject: { kind: 'connection', plugin: connection.plugin, connection: connection.key },
    });
  }

  return conditions;
}

/** An alert's severity as the tool counts it: a success that fires is information. */
const ALERT_SEVERITY: Readonly<Record<ActivitySeverity, Severity>> = { error: 'error', warning: 'warning', info: 'info', success: 'info' };

/** The label of an alert the host does not know to be true any more. */
const NOT_CONFIRMED = 'Not confirmed';

/**
 * The alerts that plugins report through the activity service, which keeps them by the plugin's own key (the SDK's `Alert`): the ones that are FIRING are conditions, worded by the alert's own title and message; the ones that
 * RESOLVED are not (a condition goes when it stops being true); and the ones that are UNKNOWN are shown as "Not confirmed", as a warning whatever their severity was. The host turns a firing alert unknown when its plugin's
 * process is lost, so it does not know that the alert is still true and says so, in a sentence that names the plugin, instead of hiding what may well be true or claiming it is. A task and a message are never a condition. The
 * row is about the connection when the window knows it and goes to it, else to the plugin; a record of the host's own work names no plugin and has no page.
 */
export function alertConditions(records: readonly ActivityRecordLike[], resolve: SourceResolver): readonly Condition[] {
  const conditions: Condition[] = [];
  for (const record of records) {
    if (record.kind !== 'alert' || record.alert === undefined || record.alert.state === 'resolved') {
      continue;
    }

    const { pluginID, connectionID } = record.source;
    const plugin = resolve.plugin(pluginID);
    const { title, message } = record.presentation;
    const firing = record.alert.state === 'firing';
    conditions.push({
      key: `alert:${record.id}`,
      severity: firing ? ALERT_SEVERITY[record.severity] : 'warning',
      label: firing ? title : NOT_CONFIRMED,
      title: firing ? (message === undefined || message === '' ? title : `${title}. ${message}`) : `${title}. ${plugin.name} is not reporting, so it is not known whether this is still true.`,
      source: { id: plugin.id, name: plugin.name },
      target: pluginID === undefined || pluginID === '' || connectionID === undefined ? undefined : resolve.connection(pluginID, connectionID),
      subject: subjectOf(record.source, resolve),
    });
  }

  return conditions;
}

/** The label of the one condition that the activity service's own failure is: the Condition column's word, which the tool's cell cuts when it must. */
const ACTIVITY_UNAVAILABLE = 'Activity isn\'t available';

/**
 * The failure to observe the host's activity service, as a condition of the host. The alerts of the plugins and their tasks come through that service, and a read of it that failed holds no record, as a read of no activity does not:
 * without this the two look alike and the tools say "no problems" for a window that knows nothing. The producer (the runtime's provider, through the feed) states the fact and `error` is its sentence, so the condition is true for
 * exactly as long as the sentence is there and goes the moment the feed has none (S74). It is a warning (nothing is broken that this window can name; what it knows is not complete), has no target and no page of its own, and is the
 * host's source as the resolver says it, as an alert that names no plugin is. One key for every sentence, so it is one row while the failure is told in other words. The sentence is worded as a connection's reason is: without the space
 * around it, and as the label alone when there is none.
 */
export function activityConditions(error: string | undefined, resolve: SourceResolver): readonly Condition[] {
  if (error === undefined) {
    return [];
  }

  const host = resolve.plugin(undefined);
  const sentence = error.trim();
  return [
    {
      key: 'activity:unavailable',
      severity: 'warning',
      label: ACTIVITY_UNAVAILABLE,
      title: sentence === '' ? ACTIVITY_UNAVAILABLE : sentence,
      source: { id: host.id, name: host.name },
      target: undefined,
      subject: undefined,
    },
  ];
}
