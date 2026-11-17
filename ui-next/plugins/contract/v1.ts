import type { ListPageDefinition, ListSource } from '../../page';
import type { ShellAccent, ShellRegistration, ShellTreeNode } from '../../shell';

// A plugin writes its contribution against this one module: the types of the list page and the shell it fills in come out of it.
export type { ListPageDefinition, ListQuickFilter, ListQuickFilters, ListSource, ListSourceState } from '../../page';
export type { ShellAccent, ShellScopeFace } from '../../shell';

// The first contribution contract, version 1: what a plugin's new-UI bundle hands the host, and nothing else. Types only; the module's run time
// counterpart is `admit.ts`. Written to move to the surface plugins import (docs/ui-next/slices/n19-plugin-seam.md, 2.5): it imports the host's
// types for the shell and the list page now, and when they move out they move together with this file.
//
// A bundle exports ONE value, named for the contract it implements: `contributionV1`. A later contract is a new export beside it
// (`contributionV2`), so one archive can serve hosts of two contract generations and a host takes the highest version it knows. There is no
// version field inside the object: the export name is the version.
//
// Everything a plugin may use at run time is the shared list (`../loader/specifiers.ts`): React, the kit and, with the curated runtime entry, the
// data hooks. A contribution is plain data and functions; it never reaches into the shell's DOM and never imports the host.

/** A node of the sidebar's tree: an entry (a leaf) or a group (it has `children`). The id of a leaf is the id of the page it opens. */
export type SidebarNodeV1 = ShellTreeNode;

/** Where the host asks a contribution to show itself. `connection` is the scope the user chose; it is absent until one is chosen. */
export type RouteV1 = {
  /** A key of `ContributionV1.pages`. */
  readonly page: string;
  readonly connection?: string | undefined;
};

/** What the host tells a contribution's hooks: which plugin it is (the id it is installed under) and the route it is shown for. */
export type ContextV1 = {
  readonly plugin: string;
  readonly route: RouteV1;
};

/** How a page sits in the frame: the tab, the status bar's path and the scope lane. The page learns these from its data, so its hook returns them. */
export type FrameV1 = Pick<ShellRegistration, 'tab' | 'path' | 'scope'>;

/** What a list page's data hook answers: the frame, and the rows with their state. The host draws both; the page reads no data layer. */
export type ListPageViewV1<TRow> = {
  readonly frame: FrameV1;
  readonly source: ListSource<TRow>;
};

/**
 * A list page: a static definition the host's list page draws (the columns, the words, the quick filters), and the page's one data hook
 * (docs/ui-next/optimisations.md MNR-T8). The host calls `usePage` unconditionally, in a component keyed by the page, inside the page's own error
 * boundary: a hook that throws takes this page down and no other contribution.
 */
export type ListPageV1<TRow> = {
  readonly kind: 'list';
  readonly definition: ListPageDefinition<TRow>;
  readonly usePage: (context: ContextV1) => ListPageViewV1<TRow>;
};

/**
 * The sidebar: its words and a static skeleton that draws before any data is read, and optionally a hook for what depends on the connection.
 * While the hook answers `undefined` the skeleton stays; an array replaces it. A hook that throws leaves the skeleton and the failure in the
 * sidebar's own boundary.
 */
export type SidebarV1 = {
  /** Names the navigation landmark and its tree. */
  readonly label: string;
  /** The title of the sidebar's header. */
  readonly title: string;
  readonly nodes: readonly SidebarNodeV1[];
  readonly useNodes?: ((context: ContextV1) => readonly SidebarNodeV1[] | undefined) | undefined;
};

/**
 * A page of any row type. The host holds pages of different row types in one record, and each page's definition and hook are typed together where the
 * plugin writes them (`satisfies ListPageV1<Row>`), so the record erases the row type in this one place.
 */
 
export type PageV1 = ListPageV1<any>;

export type ContributionV1 = {
  /** The plugin as the frame names it ("<name> workspace"), and the colour of the sidebar's glyphs. */
  readonly plugin: { readonly name: string; readonly accent?: ShellAccent | undefined };
  /** The frame has a rail track (the rail's tools are not part of this contract). */
  readonly rail?: true | undefined;
  readonly sidebar: SidebarV1;
  /** The plugin's pages by id. The id of a sidebar leaf names one of them. */
  readonly pages: Readonly<Record<string, PageV1>>;
  /** The page the window opens first for this plugin, with no URL: a key of `pages`. */
  readonly home: string;
};
