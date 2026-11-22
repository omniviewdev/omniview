import type { IconName } from '@omniviewdev/kit';
import type { PageMemory } from '../../../page';
import type { ShellAccent } from '../../../plugins/contract/v1';
import type { PluginSource } from '../../../plugins/host/contributions';
import { readUnloaded, type EventSource } from '../../../plugins/host/lifecycle';
import type { PluginEntry } from '../../../plugins/host/pluginStore';
import { DEFAULT_RAIL_ICON, railOf } from '../../../plugins/host/rail';
import { actionsOf, type Actions, type Availability } from './availability';
import { readEnablement, readStateChange, type Phase } from './events';
import { compareInstalled, listOf } from './inventory';
import { stateOf } from './state';
import type { Installed, InventoryEntry, Operation, State } from './types';

// The Plugins page's model: the installed plugins as one list of rows, from what the host says of them. It is framework-free (React reads it through `useSyncExternalStore`), and every dependency is injected, so the rules
// here are tests with no host, no runtime and no browser (`model.test.ts`, `operations.test.ts`).
//
// WHERE EACH FACT COMES FROM. The manifest facts and the phase are the host's inventory, read on opening and again after each event that changes it (`plugin/inventory_changed`, `install_finished`, `update_complete`,
// `init_complete`, `enablement_changed`), and after an action ends, and never by a timer. What happens to ONE plugin between two reads is the host's events: `plugin/state_change` (the phase it entered), `plugin/unloaded`
// (uninstalled: the plugin leaves the list; the other causes are the window's plugin store's to say) and `plugin/enablement_changed`. The interface half is the window's plugin store, the entries the rail reads, so the two cannot
// say two things of one plugin. The work in flight is this page's own calls.
//
// EVENTS AND READS ARE ORDERED BY A LOGICAL CLOCK. Each event handled ticks it. A read remembers the tick it began at, and what an event said AFTER that tick is newer than the answer and stands over it; what an event said
// before is older than the answer and is dropped. So a read that was out when an uninstall was heard does not bring the plugin back, and a read that began after does.
//
// THE HOST DELETES A PLUGIN'S RECORD FOR THE WHOLE OF A RELOAD (the inventory lists none until the load ends: PLB-03 in the status file), so a plugin the window's store still holds stays on the list, with what was last known of
// it, whatever the inventory says; the store forgets a plugin that was uninstalled or turned off.

/** The host's actions on a plugin, as this page calls them (`PluginManager`). Each resolves when the host has done it, and rejects with the host's error. */
export type PluginActions = {
  /** Stops the plugin and starts it again (`ReloadPlugin`): for a plugin that is stopped, starts it. */
  readonly reload: (id: string) => Promise<unknown>;
  /** Persists the person's choice (`SetPluginEnabled`). Turning a plugin ON does not start it: the model follows it with a reload. */
  readonly setEnabled: (id: string, enabled: boolean) => Promise<unknown>;
  readonly uninstall: (id: string) => Promise<unknown>;
};

/** An action the host did not do: the page tells the person through the host's notices, with a Retry that runs it again. */
export type ActionFailure = {
  readonly operation: Operation;
  readonly id: string;
  /** What the plugin is called. */
  readonly name: string;
  /** The error the call rejected with: read for its class by the host's reporter, never shown. */
  readonly error: unknown;
  readonly retry: () => void;
};

export type PluginsModelDeps = {
  /** The host's inventory (`PluginManager.ListPlugins`). */
  readonly read: () => Promise<readonly InventoryEntry[]>;
  /** The inventory the window already holds, so the first frame has the list. Absent: the page says it is loading until the host answers. */
  readonly seed?: (() => readonly InventoryEntry[] | undefined) | undefined;
  /** The window's plugin store: what each plugin's interface came to. */
  readonly entries: PluginSource;
  /** The runtime's `Events`. */
  readonly events: EventSource;
  readonly actions: PluginActions;
  /** The window's own Retry for a plugin that is not there: the one the rail's failed tab has (`PluginStore.retry`), so a failure is retried one way. */
  readonly retry: (id: string) => void;
  readonly fail: (failure: ActionFailure) => void;
  /** Where the page keeps which plugin the person was reading (`PageMemory`). */
  readonly memory?: PageMemory | undefined;
};

/** The glyph and colour that stand for a plugin: the rail's own (the plugin's contribution says them), so a plugin looks the same in the rail and in the list, and the host's own glyph for one that has none. */
export type Tile = { readonly icon: IconName; readonly accent: ShellAccent | undefined };

/** One plugin as the list draws it. The same object until something it says changes. */
export type RowView = {
  readonly id: string;
  readonly plugin: Installed;
  readonly tile: Tile;
  readonly state: State;
  /** The work this page has under way on the plugin. */
  readonly op: Operation | null;
  readonly actions: Actions;
};

export type ListState = {
  readonly status: 'loading' | 'ready' | 'failed';
  /** The plugins, in the order the list draws them. */
  readonly ids: readonly string[];
  /** The plugin whose detail is shown; one of `ids`, or null while the list is empty. */
  readonly selected: string | null;
};

export type PluginsModel = {
  readonly getSnapshot: () => ListState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly row: (id: string) => RowView | undefined;
  /** Tells `listener` when the row of `id` changes; nothing else. */
  readonly subscribeRow: (id: string, listener: () => void) => () => void;
  readonly select: (id: string) => void;
  /** Reads the host's inventory again. A request that comes while a read is out is answered by one more read. */
  readonly refresh: () => void;
  /**
   * Starts listening to the host: its events and the window's plugin store, and reads the inventory (what was said while nobody listened was not heard). Answers the function that stops listening. A page that is hidden
   * stops, and one that is shown again attaches again.
   */
  readonly attach: () => () => void;
  readonly reload: (id: string) => void;
  /** The window's Retry for a plugin that failed; for one the window does not hold, a reload. */
  readonly retry: (id: string) => void;
  /** Replaces the window's Retry the model calls: the window hands a new one whenever its list of plugins changes, and the model is made once. */
  readonly setRetry: (retry: (id: string) => void) => void;
  readonly enable: (id: string) => void;
  readonly disable: (id: string) => void;
  readonly uninstall: (id: string) => void;
};

/** What events said of a plugin after the read that is on screen began. */
type Patch = { readonly at: number; readonly phase?: Phase | undefined; readonly enabled?: boolean | undefined; readonly removed?: boolean | undefined };

/** The events that change the list: the ones the window's own inventory is read again after (`useInstalledPlugins`). */
const INVENTORY_EVENTS = ['plugin/init_complete', 'plugin/inventory_changed', 'plugin/install_finished', 'plugin/update_complete'] as const;

const sameWords = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((word, index) => word === b[index]);

function sameInstalled(a: Installed, b: Installed): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.version === b.version &&
    a.description === b.description &&
    a.publisher === b.publisher &&
    a.license === b.license &&
    a.category === b.category &&
    a.repository === b.repository &&
    a.website === b.website &&
    a.builtin === b.builtin &&
    a.enabled === b.enabled &&
    a.devMode === b.devMode &&
    a.releaseChannel === b.releaseChannel &&
    a.phase === b.phase &&
    sameWords(a.tags, b.tags) &&
    sameWords(a.dependencies, b.dependencies) &&
    sameWords(a.capabilities, b.capabilities)
  );
}

const sameState = (a: State, b: State): boolean =>
  a.kind === b.kind && a.word === b.word && a.tone === b.tone && a.busy === b.busy && a.cause === b.cause && a.title === b.title && a.sentence === b.sentence && a.faulted === b.faulted;

const reasonOf = (availability: Availability): string => (availability.available ? '' : availability.reason);

const sameActions = (a: Actions, b: Actions): boolean => (['retry', 'reload', 'enable', 'disable', 'uninstall'] as const).every((name) => a[name].available === b[name].available && reasonOf(a[name]) === reasonOf(b[name]));

const sameRow = (a: RowView, b: RowView): boolean =>
  a.op === b.op && a.tile.icon === b.tile.icon && a.tile.accent === b.tile.accent && sameInstalled(a.plugin, b.plugin) && sameState(a.state, b.state) && sameActions(a.actions, b.actions);

/** The tile of a plugin: the rail's entry for a plugin that has loaded, else the host's own glyph. */
function tileOf(entry: PluginEntry | undefined): Tile {
  const placed = entry?.phase === 'ready' ? railOf([entry])[0] : undefined;
  return { icon: placed?.icon ?? DEFAULT_RAIL_ICON, accent: placed?.accent };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the page was left with, read back: the plugin the person was reading, or none. */
function keptSelection(kept: unknown): string | undefined {
  const selected = isRecord(kept) ? kept.selected : undefined;
  return typeof selected === 'string' && selected !== '' ? selected : undefined;
}

/** What the page writes down: the host's record with the plugin set, the other members as they were. */
function keepSelection(kept: unknown, id: string): unknown {
  return { ...(isRecord(kept) ? kept : {}), selected: id };
}

export function createPluginsModel(deps: PluginsModelDeps): PluginsModel {
  const { memory } = deps;
  let retryWindow = deps.retry;
  let tick = 0;
  let base = new Map<string, Installed>();
  let known = new Map<string, Installed>();
  const patches = new Map<string, Patch>();
  const ops = new Map<string, Operation>();
  let held = new Map<string, PluginEntry>();
  let rows = new Map<string, RowView>();
  let status: ListState['status'] = 'loading';
  let selected: string | null = null;
  let ids: readonly string[] = [];
  let snapshot: ListState = { status, ids, selected };
  let reading = false;
  let again = false;
  const listeners = new Set<() => void>();
  const rowListeners = new Map<string, Set<() => void>>();

  /** The plugin as it is now: the newest list the host sent, what the events said after it began, and (for a plugin the host lists none of) what the window knows. */
  const installedAt = (id: string): Installed | undefined => {
    const patch = patches.get(id);
    if (patch?.removed === true) {
      return undefined;
    }

    const entry = held.get(id);
    const found = base.get(id) ?? (entry === undefined ? undefined : (known.get(id) ?? { ...emptyInstalled(id), name: entry.name }));
    if (found === undefined) {
      return undefined;
    }

    return patch === undefined || (patch.phase === undefined && patch.enabled === undefined) ? found : { ...found, phase: patch.phase ?? found.phase, enabled: patch.enabled ?? found.enabled };
  };

  const rowAt = (id: string): RowView | undefined => {
    const installed = installedAt(id);
    if (installed === undefined) {
      return undefined;
    }

    const entry = held.get(id);
    const state = stateOf({ installed, entry, removing: false });
    const op = ops.get(id) ?? null;
    return { id, plugin: installed, tile: tileOf(entry), state, op, actions: actionsOf(installed, state, op) };
  };

  const notifyRow = (id: string): void => {
    for (const listener of [...(rowListeners.get(id) ?? [])]) {
      listener();
    }
  };

  const notifyList = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** Puts a row in step with what is known; answers whether the row changed (and tells its listeners). */
  const settleRow = (id: string, next: RowView | undefined): boolean => {
    const before = rows.get(id);
    if (next === undefined) {
      if (before === undefined) {
        return false;
      }

      rows.delete(id);
      notifyRow(id);
      return true;
    }

    if (before !== undefined && sameRow(before, next)) {
      return false;
    }

    rows.set(id, next);
    notifyRow(id);
    return true;
  };

  const neighbourOf = (id: string, order: readonly string[]): string | null => {
    const at = order.indexOf(id);
    return order[at + 1] ?? order[at - 1] ?? null;
  };

  /** The order and the selection, after the rows were settled: the list changes only when its members, their order, the selection or the status did. */
  const settleList = (): void => {
    const next = [...rows.values()].map((row) => row.plugin).sort(compareInstalled).map((plugin) => plugin.id);
    const members = ids.length === next.length && ids.every((id, index) => id === next[index]) ? ids : next;
    let choice = selected;
    if (choice === null || !members.includes(choice)) {
      const kept = choice === null ? keptSelection(memory?.read()) : undefined;
      choice = kept !== undefined && members.includes(kept) ? kept : choice !== null && ids.includes(choice) ? neighbourOf(choice, ids) : (members[0] ?? null);
      if (choice !== null && !members.includes(choice)) {
        choice = members[0] ?? null;
      }
    }

    if (members === ids && choice === selected && snapshot.status === status) {
      return;
    }

    ids = members;
    selected = choice;
    snapshot = { status, ids, selected };
    notifyList();
  };

  /** Everything is worked out again: the list a read brought, a plugin the window gained or lost. */
  const settleAll = (): void => {
    const every = new Set<string>([...base.keys(), ...held.keys(), ...rows.keys()]);
    for (const id of every) {
      settleRow(id, rowAt(id));
    }

    settleList();
  };

  /** One plugin changed. When it is still a row of the same name nothing about the list changes, and only that row is worked out. */
  const settleOne = (id: string): void => {
    const before = rows.get(id);
    const next = rowAt(id);
    if (before === undefined || next === undefined) {
      settleAll();
      return;
    }

    if (before.plugin.name !== next.plugin.name) {
      settleAll();
      return;
    }

    settleRow(id, next);
  };

  const acceptList = (entries: readonly InventoryEntry[], startedAt: number): void => {
    const list = listOf(entries);
    base = new Map(list.map((plugin) => [plugin.id, plugin]));
    known = new Map([...known, ...base]);
    for (const [id, patch] of patches) {
      if (patch.at <= startedAt) {
        patches.delete(id);
      }
    }

    status = 'ready';
    settleAll();
  };

  const refresh = (): void => {
    if (reading) {
      again = true;
      return;
    }

    reading = true;
    const startedAt = tick;
    deps.read().then(
      (entries) => {
        reading = false;
        acceptList(entries, startedAt);
        if (again) {
          again = false;
          refresh();
        }
      },
      (error: unknown) => {
        reading = false;
        console.warn('[plugins] the list of installed plugins could not be read', error);
        if (status === 'loading') {
          status = 'failed';
          settleList();
        }

        if (again) {
          again = false;
          refresh();
        }
      },
    );
  };

  const patch = (id: string, change: Omit<Patch, 'at'>): void => {
    tick += 1;
    patches.set(id, { ...patches.get(id), ...change, at: tick });
  };

  const onEntries = (): void => {
    const next = new Map(deps.entries.getSnapshot().map((entry) => [entry.id, entry]));
    const changed = new Set<string>();
    for (const [id, entry] of next) {
      if (held.get(id) !== entry) {
        changed.add(id);
      }
    }

    for (const id of held.keys()) {
      if (!next.has(id)) {
        changed.add(id);
      }
    }

    held = next;
    if (changed.size === 0) {
      return;
    }

    // A plugin the store gained or lost may be one the list has to gain or lose; one it only changed is one row.
    if ([...changed].some((id) => !base.has(id))) {
      settleAll();
      return;
    }

    for (const id of changed) {
      settleOne(id);
    }
  };

  const attach = (): (() => void) => {
    held = new Map(deps.entries.getSnapshot().map((entry) => [entry.id, entry]));
    const stops = [
      deps.events.On('plugin/state_change', ({ data }) => {
        const change = readStateChange(data);
        if (change === undefined) {
          return;
        }

        if (!rows.has(change.id)) {
          // A plugin this page does not list may be a new one: the host says what it is.
          tick += 1;
          refresh();
          return;
        }

        patch(change.id, { phase: change.phase });
        settleOne(change.id);
      }),
      deps.events.On('plugin/unloaded', ({ data }) => {
        const gone = readUnloaded(data);
        if (gone?.cause !== 'uninstalled') {
          return;
        }

        patch(gone.id, { removed: true });
        settleAll();
      }),
      deps.events.On('plugin/enablement_changed', ({ data }) => {
        const change = readEnablement(data);
        if (change !== undefined && rows.has(change.id)) {
          patch(change.id, { enabled: change.enabled });
          settleOne(change.id);
        }

        refresh();
      }),
      ...INVENTORY_EVENTS.map((name) =>
        deps.events.On(name, () => {
          refresh();
        }),
      ),
      deps.entries.subscribe(onEntries),
    ];
    settleAll();
    refresh();
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  };

  /**
   * Runs one of the host's actions on a plugin: the row says the work is going on from now until the host answers, and what the plugin came to is what the events and the read after it say, never what this page hopes. A
   * call that fails is the host's to word and the person's to retry; the inventory is read again either way, because the host tells nothing for some of what can fail (a failed stop, a rolled-back uninstall).
   */
  const run = (operation: Operation, permit: keyof Actions, id: string, call: () => Promise<unknown>): void => {
    const row = rows.get(id);
    if (!row?.actions[permit].available) {
      return;
    }

    ops.set(id, operation);
    settleOne(id);
    const finish = (): void => {
      ops.delete(id);
      settleOne(id);
      refresh();
    };

    call().then(finish, (error: unknown) => {
      finish();
      deps.fail({
        operation,
        id,
        name: row.plugin.name,
        error,
        retry: () => {
          run(operation, permit, id, call);
        },
      });
    });
  };

  const reload = (id: string): void => {
    run('reload', 'reload', id, async () => deps.actions.reload(id));
  };

  // The first frame has what the window already holds: the plugin store's entries, and the inventory it read.
  held = new Map(deps.entries.getSnapshot().map((entry) => [entry.id, entry]));
  const seeded = deps.seed?.();
  if (seeded !== undefined) {
    acceptList(seeded, 0);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    row: (id) => rows.get(id),
    subscribeRow: (id, listener) => {
      const set = rowListeners.get(id) ?? new Set<() => void>();
      rowListeners.set(id, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          rowListeners.delete(id);
        }
      };
    },
    select: (id) => {
      if (!rows.has(id) || selected === id) {
        return;
      }

      selected = id;
      snapshot = { status, ids, selected };
      memory?.write(keepSelection(memory.read(), id));
      notifyList();
    },
    refresh,
    attach,
    reload,
    retry: (id) => {
      const row = rows.get(id);
      if (!row?.actions.retry.available) {
        return;
      }

      if (held.get(id)?.phase === 'failed') {
        retryWindow(id);
      } else {
        // The window holds no failed entry for it (the product's own plugin, or one the window never loaded): the host is asked directly.
        run('reload', 'retry', id, async () => deps.actions.reload(id));
      }
    },
    enable: (id) => {
      run('enable', 'enable', id, async () => {
        await deps.actions.setEnabled(id, true);
        await deps.actions.reload(id);
      });
    },
    disable: (id) => {
      run('disable', 'disable', id, async () => deps.actions.setEnabled(id, false));
    },
    setRetry: (next) => {
      retryWindow = next;
    },
    uninstall: (id) => {
      run('uninstall', 'uninstall', id, async () => deps.actions.uninstall(id));
    },
  };
}

/** A plugin of which only the id is known. */
function emptyInstalled(id: string): Installed {
  return { id, name: id, version: '', description: '', publisher: '', license: '', category: '', repository: '', website: '', tags: [], dependencies: [], capabilities: [], builtin: false, enabled: true, devMode: false, releaseChannel: '', phase: 'Failed' };
}
