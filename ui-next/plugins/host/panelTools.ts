import { dispositionOf, type Contributions, type TabsStore } from '../../shell';
import type { NoticesStore } from '../../shell/core/notices';
import type { ActivityFeed, SourceResolver } from '../../shell/panel/activity';
import { HOST_SOURCE } from '../../shell/panel/activity';
import type { ToolBadges } from '../../shell/panel/badge';
import type { OpenSubject, Subject } from '../../shell/panel/subject';
import { OPERATIONS_TOOL_ID, type CancelFailure, type Operations } from '../../shell/panel/operations';
import { PROBLEMS_TOOL_ID, type Problems } from '../../shell/panel/problems';
import { activityConditions, alertConditions, connectionConditions, pluginConditions } from './conditions';
import type { ConnectionActions, ConnectionsStore, HostConnection } from './connections';
import { HOME_PAGE, type PluginSource } from './contributions';
import type { PluginEntry } from './pluginStore';

// The host's side of the Problems and Operations tools (ch16 S121, S122; docs/ui-next/status/PT1.md): which producers feed them and what keeps them true while the window lives. The tools and their models are the shell's
// (`shell/panel/problems`, `shell/panel/operations`) and know no plugin; the producers are what the window already holds, each read where it is already live and never polled:
//
//   plugins      the window's plugin entries (`PluginStore`: a plugin that stopped, did not start, was refused or whose interface did not load; the host's events keep it current, PU1 and PU2)
//   connections  the connection store (a start that failed, by class; `connection/status` keeps it current)
//   alerts       the activity service's alerts (a condition a plugin process reports and resolves; the runtime's provider observes them and the screen's tap hands them over, `PluginHostScreen.tsx`)
//   activity     the activity service itself: when the provider could not observe it the feed carries its sentence, and one condition of the host says that nothing is known of the alerts and the tasks while it stands
//   operations   the activity service's tasks, the same feed
//
// A change of a plugin's name or of a connection's makes the rows of every tool say the new name, so a change of the plugins or the connections refreshes all of it; a change of the records is read by the tool that
// reads them (and by the alerts here): a task's progress tick wakes the Operations model and nothing else.

/** The name of a plugin the window shows: its contribution's name once it is ready, else the name its manifest gives it, else its id (an installed plugin the window has not been told of). */
function nameOf(entries: readonly PluginEntry[], id: string): string {
  const entry = entries.find((candidate) => candidate.id === id);
  return entry === undefined ? id : entry.phase === 'ready' ? entry.contribution.plugin.name : entry.name;
}

/** The host's own work is `Omniview`: a record that names no plugin. */
export const HOST_NAME = 'Omniview';

/** The names of the connections that one list of the connection store holds, by the plugin and then by the connection's key. */
type ConnectionNames = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Reads each connection of the list once. A key that a plugin lists twice is named by its first entry, as a search for it would find it. */
function indexConnections(list: readonly HostConnection[]): ConnectionNames {
  const names = new Map<string, Map<string, string>>();
  for (const { plugin, key, name } of list) {
    let keys = names.get(plugin);
    if (keys === undefined) {
      keys = new Map();
      names.set(plugin, keys);
    }

    if (!keys.has(key)) {
      keys.set(key, name);
    }
  }

  return names;
}

/**
 * What a person reads for a plugin and for a connection, from what the window holds now: the plugin store and the connection store are the sources, and a name that changes (a plugin that has finished loading, a connection that
 * was renamed) is the next answer. The connection store's list is the same array until something in it changes, so the names are indexed when the list is another one and not before: a lookup costs one step however many connections
 * the window has and however many rows ask (a hundred alerts over five thousand connections would otherwise read about a million of them every time the alerts are made again, which is every tick of every task).
 */
export function resolverOf(plugins: PluginSource, connections: Pick<ConnectionsStore, 'getSnapshot'> | undefined): SourceResolver {
  // The list that the index was made from, and the index.
  let listed: readonly HostConnection[] | undefined;
  let names: ConnectionNames = new Map();
  return {
    plugin: (id) => (id === undefined || id === '' ? { id: HOST_SOURCE, name: HOST_NAME } : { id, name: nameOf(plugins.getSnapshot(), id) }),
    connection: (plugin, key) => {
      if (connections === undefined) {
        return undefined;
      }

      const { connections: list } = connections.getSnapshot();
      if (list !== listed) {
        names = indexConnections(list);
        listed = list;
      }

      return names.get(plugin)?.get(key);
    },
  };
}

export type PanelToolsDeps = {
  readonly plugins: PluginSource;
  /** Absent: the window has no connection data, and no connection is ever a problem. */
  readonly connections: Pick<ConnectionsStore, 'getSnapshot' | 'subscribe'> | undefined;
  readonly feed: ActivityFeed;
  readonly problems: Problems;
  readonly operations: Operations;
  readonly resolve: SourceResolver;
};

/**
 * Keeps both tools true for as long as the window is on screen: reads every producer once, and again when it says it changed. Answers the function that stops it (nothing is followed afterwards). It costs
 * three subscriptions and the Operations model's own, and no timer.
 */
export function attachPanelTools({ plugins, connections, feed, problems, operations, resolve }: PanelToolsDeps): () => void {
  const syncPlugins = (): void => {
    problems.set('plugins', pluginConditions(plugins.getSnapshot()));
  };

  const syncConnections = (): void => {
    if (connections === undefined) {
      problems.set('connections', []);
      return;
    }

    problems.set('connections', connectionConditions(connections.getSnapshot(), (id) => resolve.plugin(id).name));
  };

  const syncAlerts = (): void => {
    problems.set('alerts', alertConditions(feed.getSnapshot(), resolve));
  };

  // The feed says the service could not be observed with a sentence: the one condition of the host that says so is true for as long as the sentence is there.
  const syncActivity = (): void => {
    problems.set('activity', activityConditions(feed.getError(), resolve));
  };

  // A plugin's name or a connection's changed: every row that names one is made again.
  const renamed = (): void => {
    syncAlerts();
    operations.refresh();
  };

  syncPlugins();
  syncConnections();
  syncAlerts();
  syncActivity();
  const stops = [
    plugins.subscribe(() => {
      syncPlugins();
      syncConnections();
      renamed();
    }),
    connections?.subscribe(() => {
      syncConnections();
      renamed();
    }),
    feed.subscribe(() => {
      syncAlerts();
      syncActivity();
    }),
    operations.attach(),
  ];
  return () => {
    for (const stop of stops) {
      stop?.();
    }
  };
}

/**
 * What the tool tabs carry: the Problems tab its count of errors (or a dot for warnings), the Operations tab a dot for an unread failure (ch16 S114). One object for the window: its `of` answers the model's own badge, which keeps its
 * identity while it says the same, and a tab is told whenever either model changes and renders when its own badge did.
 */
export function badgesOf(problems: Problems, operations: Operations): ToolBadges {
  return {
    subscribe: (listener) => {
      const stopProblems = problems.subscribe(listener);
      const stopOperations = operations.subscribe(listener);
      return () => {
        stopProblems();
        stopOperations();
      };
    },
    of: (tool) => (tool === PROBLEMS_TOOL_ID ? problems.getSnapshot().badge : tool === OPERATIONS_TOOL_ID ? operations.getSnapshot().badge : undefined),
  };
}

/**
 * What the person is told when the host did not stop a task they asked it to stop (S84: Cancel never claims more than the producer did): an error notice of the host, which stays until they have seen it, as every error does (S78). While the
 * work is still running (`running`, read after the row was made again from the feed's latest record) it says so, with a Retry that asks again, which is the model's and puts the row back to `requested`. Once the work had finished (it ended
 * while the request was on its way, or the host dropped it) the row is no longer cancellable and a Retry would ask for nothing, so the notice says that the work had already finished and offers none. The words are the host's own: nothing
 * of the error's text is drawn (the host's refusals are plain Go errors whose text holds what the producer wrote).
 */
export function cancelFailed(store: NoticesStore, { title, error, running, retry }: CancelFailure): void {
  console.error(`[operations] the host did not cancel "${title}"`, error);
  store.notify({
    severity: 'error',
    title: `Couldn't cancel ${title}`,
    detail: running ? 'The work is still running.' : 'The work had already finished.',
    initiator: 'user',
    actions: running ? [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: retry }] : [],
  });
}

export type SubjectOpenerDeps = {
  readonly tabs: Pick<TabsStore, 'open'>;
  /** `home` is where a plugin's first page is asked of; `availability`, why the host cannot serve a route (the words it would refuse an open of a plugin it does not have with). */
  readonly contributions: Pick<Contributions, 'home' | 'availability'>;
  /** Absent: the window has no connection data, and a row about a connection opens nothing. */
  readonly connections: { readonly actions: Pick<ConnectionActions, 'go'> } | undefined;
  /** Where a choice that could not open its page says why: the window's notices, which a cancel that failed is told to as well. */
  readonly notices: Pick<NoticesStore, 'notify'>;
  /** What the person calls what a row is about, for the notice: the connection's name, else its plugin's. */
  readonly resolve: SourceResolver;
  readonly platform: 'mac' | 'other';
};

/**
 * What choosing a row of Problems or Operations does (ch16 S121: "Open {target}"): it goes to the thing the row is about, by the open model's rules, and the modifiers of the click or key pick the disposition as they do for a link. A
 * plugin is opened at its own first page, which says what happened to it and offers the Retry when it did not start; a connection is chosen the way Home and the picker choose one (`connections/actions.ts`): the host starts it first and
 * only a connection that is connected is routed to. A row whose subject cannot be opened is not a dead button: the choice is told in a notice of the host, an error that names what the button named (`Open north`: `Couldn't open north`)
 * and says why in a sentence made for the person, with no Retry. For a connection that is the refusal of the actions (it did not start, its plugin is not available now, the open model refused the page, the tab it would replace has unsaved
 * changes). For a plugin the window does not have (uninstalled or turned off while a record of it remained: an alert, a task of its history) it is what the host says of a route it cannot serve (`availability`), asked of the host and written
 * nowhere here. `source` names the tool in the tab model's record of where an open came from.
 */
export function subjectOpener({ tabs, contributions, connections, notices, resolve, platform }: SubjectOpenerDeps, source: string): OpenSubject {
  /** Tells that what the button named could not be opened, with the sentence it was given when it was given one. */
  const refused = (subject: Subject, detail: string | undefined): void => {
    const name = (subject.kind === 'connection' ? resolve.connection(subject.plugin, subject.connection) : undefined) ?? resolve.plugin(subject.plugin).name;
    notices.notify({ severity: 'error', title: `Couldn't open ${name}`, detail, initiator: 'user' });
  };

  return (subject, event) => {
    const how = dispositionOf(event, { platform });
    if (subject.kind === 'connection') {
      void connections?.actions.go(subject.plugin, subject.connection, { how, source }).then((result) => {
        if (!result.ok) {
          refused(subject, result.reason);
        }
      });
      return;
    }

    const home = contributions.home?.(subject.plugin);
    if (home === undefined) {
      // The window holds no page of the plugin. The host says why in its own words, the ones it would refuse an open of it with.
      const verdict = contributions.availability?.({ plugin: subject.plugin, contribution: HOME_PAGE, params: {} });
      refused(subject, verdict === undefined || verdict.state === 'available' ? undefined : verdict.reason);
      return;
    }

    tabs.open({ route: home }, { how, source });
  };
}
