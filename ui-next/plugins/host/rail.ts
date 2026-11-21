import { isIconName, type IconName } from '@omniviewdev/kit';
import type { RailV1, ShellAccent } from '../contract/v1';
import { failureWords } from '../loader/failure';
import type { PluginEntry } from './pluginStore';

// The window's rail, as the host decides it: which plugins have an entry, in what order, and which entry is current. Framework-free, like `pluginStore.ts`; `PluginHost` hands the shell what
// this says and the shell draws it (`ui-next/shell/Rail.tsx`). The rail is the way to every plugin that contributes, so what it holds and the order it holds it in come from the plugins'
// own declarations (`RailV1`) and from nothing that depends on how the host happens to list them: a plugin's id, the order its bundles loaded in, and the order the inventory answered in.

/** The glyph of an entry whose contribution names none, or names one the host's kit does not have: the host's own glyph for a plugin (the tab's, before its page says another). */
export const DEFAULT_RAIL_ICON: IconName = 'box';

export type RailEntry = {
  /** The plugin's id: what is chosen, and what the shell is told. */
  readonly id: string;
  /** The entry's accessible name and tooltip: the contribution's `rail.label`, else the plugin's name. */
  readonly label: string;
  readonly icon: IconName;
  /** The contribution's `rail.order`, if it gave one. */
  readonly order: number | undefined;
  /** The colour of the plugin's glyphs, for the places the window lists the plugin by a tile (the empty window). The rail itself draws every glyph in the icon colour. */
  readonly accent: ShellAccent | undefined;
  /** Only for a plugin that did not load: what the host says of it (the cause, in the host's words), which the entry's tip carries. */
  readonly problem?: string | undefined;
};

const entryOf = (entry: PluginEntry & { readonly phase: 'ready' }): RailEntry => {
  const { rail, plugin } = entry.contribution;
  const declared: RailV1 | undefined = typeof rail === 'object' ? rail : undefined;
  return {
    id: entry.id,
    label: declared?.label ?? plugin.name,
    icon: declared !== undefined && isIconName(declared.icon) ? declared.icon : DEFAULT_RAIL_ICON,
    order: declared?.order,
    accent: plugin.accent,
  };
};

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The declared order: entries that gave an `order` come first, lowest first; those that gave none follow, and entries that tie are told apart by their name and then their id, compared as
 * plain text so a machine's locale cannot move one. A total order over the entries: the same plugins give the same rail whatever order they are listed or loaded in.
 */
export function compareRail(a: RailEntry, b: RailEntry): number {
  if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
    return a.order - b.order;
  }

  if ((a.order === undefined) !== (b.order === undefined)) {
    return a.order === undefined ? 1 : -1;
  }

  return text(a.label.toLowerCase(), b.label.toLowerCase()) || text(a.label, b.label) || text(a.id, b.id);
}

/**
 * The rail's entries for the plugins that contribute: one for each plugin whose interface is loaded and was admitted, in the declared order. A plugin that is loading has none yet, and one that
 * did not load has an entry of its own kind (`failedOf`, after these): it has nothing to show, but its failure must be found. The host's own entries would lead the list; none has a destination
 * yet (README, "The rail").
 */
export function railOf(entries: readonly PluginEntry[]): readonly RailEntry[] {
  return entries
    .filter((entry): entry is PluginEntry & { readonly phase: 'ready' } => entry.phase === 'ready')
    .map(entryOf)
    .sort(compareRail);
}

/**
 * THE RULE for the order of what plugins contribute, in one place (R2). Whatever the window lists from more than one plugin is listed in the order of the rail: the plugins that contribute first, in the order
 * the rail draws them (`railOf`: what they declare today, and what the person arranges later), and the others after them as they were listed. The tools of the bottom panel are handed to its model in this
 * order (`panelPluginsOf`), the providers of the command palette are registered in it (`syncProviders`) and its pages source lists the plugins in it (`pagesOf`); a list the window makes of the plugins takes
 * its order from here and from nothing else. A plugin that finishes loading late takes the place the rail gives it, whichever plugin finished first, whatever order the plugin store lists them in and
 * however long a load took: nothing is ordered by the moment a plugin arrived (two plugins that finished at nearly the same time gave a bottom panel whose tools changed places from one run to the next).
 *
 * What a kind of contribution says of itself comes before the place of its plugin where the kind has one number for all plugins (a panel tool's `order` is a place among every tool, the host's included: the
 * mock sorts on it first), and after it where it does not (a plugin's own providers, in the order it declares them). Where two plugins' contributions are equal, this order settles it.
 */
export function inRailOrder(entries: readonly PluginEntry[]): readonly PluginEntry[] {
  const places = new Map(railOf(entries).map((entry, index) => [entry.id, index]));
  const placed = entries.filter((entry) => places.has(entry.id)).sort((a, b) => (places.get(a.id) ?? 0) - (places.get(b.id) ?? 0));
  return [...placed, ...entries.filter((entry) => !places.has(entry.id))];
}

/**
 * The plugins that did not load, and the ones that stopped (a crash, a reload: `PluginStore.unload`), one entry each after the ones that contribute, by name: a plugin the window cannot show must
 * still be there to find (a window with nothing saved opens empty, and a failure that only a page names would never be seen). The entry says what happened in its name and carries the cause in its
 * tip; it has no sidebar, so it is never the rail's current entry, and choosing it opens the plugin's page, which names the failure and offers the Retry where asking again can help. The error glyph
 * is for a fault: a plugin that is starting again after a reload keeps the plugin's own (the mock's starting plugin, ch16 S89: nothing failed).
 */
export function failedOf(entries: readonly PluginEntry[]): readonly RailEntry[] {
  return entries
    .filter((entry): entry is PluginEntry & { readonly phase: 'failed' } => entry.phase === 'failed')
    .map((entry): RailEntry => {
      const words = failureWords(entry.failure);
      return { id: entry.id, label: `${entry.name}, ${words.label}`, icon: words.faulted ? 'status-error' : DEFAULT_RAIL_ICON, order: undefined, accent: undefined, problem: entry.failure.message };
    })
    .sort(compareRail);
}

/**
 * The entry whose sidebar shows: the one the user chose, while it still has an entry; else the plugin of the tab on screen; else the first entry of the declared order. So a window that
 * opens on a plugin's tab shows that plugin's sidebar, and one with no tab shows the first plugin's.
 */
export function currentRail(rail: readonly RailEntry[], chosen: string | undefined, active: string | undefined): string | undefined {
  const has = (id: string | undefined): id is string => id !== undefined && rail.some((entry) => entry.id === id);
  if (has(chosen)) {
    return chosen;
  }

  return has(active) ? active : rail[0]?.id;
}
