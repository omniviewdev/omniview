import type { IconName } from '@omniviewdev/kit';
import type { DetailPageDefinition, DetailSource, ListPageDefinition, ListSource } from '../../page';
import type { ShellAccent, ShellScopeFace, ShellTreeNode } from '../../shell';

// A plugin writes its contribution against this one module: the types of the list page, the detail page and the shell it fills in come out of it.
export type {
  DetailIdentity,
  DetailKvSection,
  DetailListSection,
  DetailPageDefinition,
  DetailPlacement,
  DetailSection,
  DetailSource,
  DetailState,
  DetailTab,
  DetailTableSection,
  DetailTabContent,
  DetailTagsSection,
  DetailView,
  ListPageDefinition,
  ListQuickFilter,
  ListQuickFilters,
  ListSource,
  ListSourceState,
} from '../../page';
export type { ShellAccent, ShellScopeFace } from '../../shell';

// The first contribution contract, version 1: what a plugin's new-UI bundle hands the host, and nothing else. Types only; the module's run time
// counterpart is `admit.ts`. Written to move to the surface plugins import (docs/ui-next/slices/n19-plugin-seam.md, 2.5): it imports the host's
// types for the shell and the list page now, and when they move out they move together with this file.
//
// A bundle exports ONE value, named for the contract it implements: `contributionV1`. A later contract is a new export beside it
// (`contributionV2`), so one archive can serve hosts of two contract generations and a host takes the highest version it knows. There is no
// version field inside the object: the export name is the version.
//
// What a version may grow without a new export (decided at D1a, which added the detail page; recorded in docs/ui-next/status/D1a.md). The export name is the contract of a
// GENERATION of hosts, so a new export is owed when a bundle written for the old reading would be misread, or refused, by a host that has the new one, or when one archive must serve
// two generations that both exist in the field. An addition is MINOR, and stays in `contributionV1`, when all three hold: (1) it is new, an optional member or a new kind, and nothing
// that exists is removed, renamed or given another meaning; (2) every bundle written before it is admitted by this host and drawn exactly as before (`admit.test.ts` keeps one such
// bundle); (3) a host that lacks it refuses a bundle that uses it by name, at admission, from the artifact (`kind is "detail", and this version draws "list" pages`: the `contract`
// failure, "built for another version of the app", R11's refusal on proof of mismatch), and never draws it wrong. Anything else is `contributionV2`: a member removed or renamed, a
// member that becomes required of an existing kind, a hook whose input or answer changes meaning. The detail page is minor: a new page kind and a new member (`RouteV1.params`) the
// older hooks ignore, no list page changes, and an older host answers a plugin that uses it with its named refusal, where a second export would have made the plugin build and keep
// a list-only contribution for hosts that, on the feature channel, update together with their plugins.
//
// The rail entry (S2a) is minor on the same terms. `rail` grows from `true` to `true | RailV1`, a new optional shape that names the glyph, the name and the place of the plugin's entry in the
// window's rail. (1) `true` and an absent `rail` are still accepted and read nothing new: the entry gets the host's own glyph and the plugin's name. (2) Every bundle written before it is
// admitted, and drawn as before but for the entry the window now gives every plugin that contributes (`admit.test.ts` keeps one such bundle). (3) A host without it refuses a bundle that
// writes an entry, by name: its admission reads `rail` only as absent or `true` (`rail is neither absent nor true`), so the bundle is never drawn without the entry it asked for.
//
// Everything a plugin may use at run time is the shared list (`../loader/specifiers.ts`): React, the kit and, with the curated runtime entry, the
// data hooks. A contribution is plain data and functions; it never reaches into the shell's DOM and never imports the host.

/** A node of the sidebar's tree: an entry (a leaf) or a group (it has `children`). The id of a leaf is the id of the page it opens. */
export type SidebarNodeV1 = ShellTreeNode;

/**
 * Where the host asks a contribution to show itself. `connection` is the scope the user chose; it is absent until one is chosen. `params` are the route's other parameters, strings: empty
 * for a list page, the object's identity for a detail page (`connection` is not repeated in them).
 */
export type RouteV1 = {
  /** A key of `ContributionV1.pages`. */
  readonly page: string;
  readonly connection?: string | undefined;
  readonly params: Readonly<Record<string, string>>;
};

/** What the host tells a contribution's hooks: which plugin it is (the id it is installed under) and the route it is shown for. */
export type ContextV1 = {
  readonly plugin: string;
  readonly route: RouteV1;
};

/**
 * How a page sits in the frame: the tab, the status bar's path and the scope lane. The page learns these from its data, so its hook returns them. The host passes them on to the tab model
 * (the tab's title and glyph, the status bar's crumbs) and to the shell (the lane); a tab is called `{name} · {Kind}` for an object, and a title is at most three words (ch16 S10, S17).
 */
export type FrameV1 = {
  readonly tab: { readonly title: string; readonly icon: IconName };
  /** Root first; the last crumb is the page. */
  readonly path: readonly string[];
  /** At most two faces (ch16 S10). Absent or empty: no lane. */
  readonly scope?: readonly ShellScopeFace[];
};

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

/** What a detail page's data hook answers: the object's source (its state, and the view while it is read) and, once the plugin has them, the faces of the scope lane. The host draws both. */
export type DetailPageViewV1 = {
  /** At most two faces (ch16 S10). Absent or empty: no lane. The tab's title, the status bar's path and the tab's glyph are not here: they come from the route and the definition (`ui-next/page/detailIdentity.ts`). */
  readonly scope?: readonly ShellScopeFace[] | undefined;
  readonly source: DetailSource;
};

/**
 * A detail page (added to version 1 by D1a, see the rule above): the page of ONE object. A route names it by a page id and the object's identity as string parameters
 * (`definition.identity`), the tab is called `{name} · {Kind}` with the shortest qualifier, and the host draws the page header, the in-page tabs and the Overview's typed sections
 * from the static `definition` and what the one data hook answers. The host calls `usePage` unconditionally, in a component keyed by the route, inside the page's own error boundary,
 * with the route's parameters in `context.route.params`. It has no sidebar entry (it needs an object): it is reached by a link, and `home` is never a detail page.
 */
export type DetailPageV1 = {
  readonly kind: 'detail';
  readonly definition: DetailPageDefinition;
  readonly usePage: (context: ContextV1) => DetailPageViewV1;
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
 * A page of any kind and any row type. The host holds pages of different row types in one record, and each page's definition and hook are typed together where the
 * plugin writes them (`satisfies ListPageV1<Row>`, `satisfies DetailPageV1`), so the record erases the row type in this one place.
 */
export type PageV1 = ListPageV1<any> | DetailPageV1;

/**
 * The plugin's entry in the window's rail, the 40 px column left of the sidebar: one entry for every plugin that contributes, and choosing it shows this plugin's sidebar. The entries are
 * ordered by `order`, lowest first; a plugin that gives none sits after every plugin that does, by name, so the order never depends on how the host happens to list its plugins.
 */
export type RailV1 = {
  /** The entry's glyph, a name from the kit's registry. A name the host's kit does not have draws the host's own glyph, as a tab's glyph does. */
  readonly icon: IconName;
  /** What the entry is called: its accessible name and its tooltip. Absent: the plugin's name. */
  readonly label?: string | undefined;
  /** Where the entry sits among the plugins', lowest first. A finite number. */
  readonly order?: number | undefined;
};

export type ContributionV1 = {
  /** The plugin as the frame names it ("<name> workspace"), and the colour of the sidebar's glyphs. */
  readonly plugin: { readonly name: string; readonly accent?: ShellAccent | undefined };
  /** The plugin's entry in the window's rail. `true` or absent: an entry with the host's own glyph and the plugin's name. */
  readonly rail?: true | RailV1 | undefined;
  readonly sidebar: SidebarV1;
  /** The plugin's pages by id. The id of a sidebar leaf names one of them. */
  readonly pages: Readonly<Record<string, PageV1>>;
  /** The page the window opens first for this plugin, with no URL: a key of `pages`. */
  readonly home: string;
};
