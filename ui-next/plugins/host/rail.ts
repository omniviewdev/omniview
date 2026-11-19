import { isIconName, type IconName } from '@omniviewdev/kit';
import type { RailV1, ShellAccent } from '../contract/v1';
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
 * The rail's entries: one for each plugin that contributes (its interface is loaded and was admitted), in the declared order. A plugin that is loading or did not load has none: there is
 * nothing it contributes to show. The host's own entries would lead the list; none has a destination yet (README, "The rail").
 */
export function railOf(entries: readonly PluginEntry[]): readonly RailEntry[] {
  return entries
    .filter((entry): entry is PluginEntry & { readonly phase: 'ready' } => entry.phase === 'ready')
    .map(entryOf)
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

/** The plugin the window opens on when nothing says otherwise: the first of the declared order that contributes, else the first plugin there is (its page says why it did not load). */
export function firstPlugin(entries: readonly PluginEntry[]): PluginEntry | undefined {
  const first = railOf(entries)[0];
  return entries.find((entry) => entry.id === first?.id) ?? entries[0];
}
