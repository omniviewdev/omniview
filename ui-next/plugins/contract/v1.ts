import type { ReactNode } from 'react';
import type { IconName, LogFeed, LogFeedSnapshot } from '@omniviewdev/kit';
import type { ResourceReference, Value } from '@omniviewdev/runtime/ui/v1';
import type { DetailPageDefinition, DetailSource, DetailTab, ListPageDefinition, ListSource } from '../../page';
import type { ShellAccent, ShellScopeFace, ShellTreeNode } from '../../shell';

// A plugin writes its contribution against this one module: the types of the list page, the detail page, the overview page and the shell it fills in come out of it.
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
// The panel (P1a) is minor, and is the one place rule (3) cannot be kept by the letter. `panel` is a NEW optional member of the contribution: (1) nothing that exists is removed, renamed or given
// another meaning; (2) every bundle written before it is admitted, and drawn as before (`admit.test.ts` keeps one such bundle: it has no `panel`). (3) A host that predates it admits a bundle
// that has one and draws it without the tool, because admission has never refused a member it does not know: a new MEMBER, unlike a new kind of an existing member (`kind: "detail"`) or a new
// shape of one (`rail`), is not something an older admission can name. The host that ships it refuses a malformed `panel` by name (a tool with no body, a third tool). The decision this leaves
// to the owner is whether a new member needs `contributionV2` for the sake of rule (3); recorded in docs/ui-next/status/P1a.md. What a plugin brings is at most two tools of its own (S114) and,
// for the sessions it opens in a tool of the host, how their card reads; the body of a host tool is the host's, so a plugin supplies a body only for a tool of its own.
//
// The panel handle (P1b-3a) is minor, on the terms of the panel: `ContextV1.panel` is a NEW optional member, and what it holds is how a plugin asks the host to open a session in a tool of the HOST. (1) Nothing that
// exists is removed, renamed or given another meaning. (2) Every bundle written before it is admitted and drawn as before: a hook that never reads `ctx.panel` is unchanged (`admit.test.ts` keeps its bundle
// with no `panel`, and the host's tests keep a page that reads none). (3) Rule (3) turns round for a member the HOST fills in: there is nothing in the artifact for an older admission to refuse, and a host
// that lacks the handle simply leaves `ctx.panel` absent, so a plugin that needs it tests for it (`ctx.panel?.logs.open(...)`, and a command may say why it is unavailable). The handle is the plugin's side of
// owner decision A20: a Logs session starts from the resource (a plugin's page or command), never from the panel, and the thing a plugin hands over is a plain target descriptor (`LogTargetV1`), so a
// registry and a picker can later list the very same descriptors and call the same function without a change to this contract.
//
// The sidebar's open groups and the entry's count (Q2a) are minor, on the terms of the panel handle: `useNodes` is told ONE member more, `open`, and a node's `count` has two shapes more. (1) Nothing that exists is removed,
// renamed or given another meaning: `SidebarContextV1` is `ContextV1` and one member, so a hook that reads the context every hook gets is called with all of it, and a plain number draws as it always did. (2) Every bundle written
// before it is admitted and drawn as before (`admit.test.ts` keeps one: its hook reads only the context every hook gets and its entries carry plain numbers; `PluginHost.test.tsx` runs one). (3) What a host that lacks them does is
// settled in the bundle, not at run time: a count is read as a number only before this, so a bundle that writes an approximate count or a `null` count in its static skeleton, as a plugin that draws counts does (the `null` of an
// entry is the slot it fills, and the slot's width), is refused by name by a host that predates them (`count is not a number`, the `contract` failure, R11's refusal on proof of mismatch) and is never drawn wrong; `open` is a member
// the HOST fills in, and a host that lacks it leaves it `undefined`, which a plugin that reads it without declaring a `null` count has nothing to be refused by (it tests for it). An approximate count is how the owner approved an estimate
// to read: "~1,234", named "about 1,234"; the mock's own word for it in a footer is "About 120" (`H.count`, core.js:1879), for which the slot has no room.
//
// The palette's providers (C1c) are minor, on the terms of the panel: `palette` is a NEW optional member of the contribution. (1) Nothing that exists is removed, renamed or given another meaning. (2) Every bundle
// written before it is admitted and drawn as before: a bundle with no `palette` registers no provider and the palette lists what it listed (`admit.test.ts` keeps one, and `PluginHost.palette.test.tsx` runs a window with
// one). (3) Rule (3) cannot be kept by the letter for a new member, as for `panel`: an older host's admission has never refused a member it does not know, so it admits a bundle that has one and the palette has none of that
// plugin's providers (`admit.test.ts` shows the member is the only difference: the same bundle without it is the older contract, and the two are assignable to each other in types). Admission refuses a malformed DECLARATION
// by name, as it does a malformed `panel` (a provider of a kind this version does not know, a provider with no way to answer, a fifth provider), and reads the ROWS a provider answers one at a time while the palette runs
// (`paletteRows.ts`): a row that is not valid is left out with a problem for its provider, and no other row, provider or plugin is affected. A row is DATA: words, a glyph from the kit's registry, and either a route to
// one of the plugin's own pages or the id of one of its own commands. It never holds code that draws.
//
// The sidebar's keywords (C1e) are minor, on the terms of the palette's providers: `keywords` is a NEW optional member of a sidebar NODE, the other names its page is known by (the short name a tool gives the thing:
// `ws` for Workshops). (1) Nothing that exists is removed, renamed or given another meaning. (2) Every bundle written before it is admitted and drawn as before: a node with no `keywords` is a page the palette finds
// by its title, its group and its plugin's name, as it did (`admit.test.ts` keeps one, and `PluginHost.palette.test.tsx` runs a window with one). (3) Rule (3) cannot be kept by the letter for a new member, as for
// `panel` and `palette`: an older host's admission has never refused a member it does not know, so it admits a bundle whose nodes carry keywords, draws its sidebar as before and finds the page by its title alone
// (`admit.test.ts` shows the member is the only difference, and that a node of either contract is a node of the other in types). Admission does not refuse for a keyword that is not valid, and does not read the member at
// all: a sidebar hook answers its nodes anew on every render, so the words are read where they are used (`sidebarKeywords.ts`), one at a time, and a keyword that is not one word of at most 32 characters, or comes after the
// eighth, is left out with a problem for the plugin's author and costs the node nothing else. Only the keywords of an entry (a leaf, a page the palette can go to) are read: a group is not a page.
//
// The title of a not-found detail state (K2c-2) is minor, on the terms of the sidebar's keywords: `title` is a NEW optional member of the `not-found` state a detail hook answers, the plugin's own title for the state ("lathe-4 was deleted"
// over its `message`, "It no longer exists in north."), where the page's is "<name> was not found" for an object that was deleted as well as for one that never was. (1) Nothing that exists is removed, renamed or given another meaning.
// (2) Every bundle written before it is drawn as before: a `not-found` with no `title` has the page's title and, with no `message`, the page's message (`detailView.test.ts`, `PluginHost.detail.test.tsx`). (3) Rule (3) cannot be kept by the
// letter for a new member, as for `keywords`: a host that predates it never reads `title`, so a bundle that gives one is admitted and drawn with the old title over its message (`detailView.test.ts` shows the member is the only difference,
// and that a state of either contract is a state of the other in types); nothing is refused. The page reads `title` where it is used and never refuses for it: a title that is not text, is empty, or is longer than 120 characters is
// no title, and white space in one is one space.
//
// The connection marker (C1g) is minor, on the terms of the keywords: `role` is a NEW optional member of a FACE of the scope lane (`ShellScopeFace`), and its one value, `'connection'`, says the face's text is the NAME of the connection the
// page is read in. A route carries a connection by a KEY, a plugin's own id for it, which is not for reading: the host says a connection by its name wherever it says one (the tab strip, the status bar, a detail page's header, the palette)
// and by the key nowhere, and where it knows no name it says no connection. (1) Nothing that exists is removed, renamed or given another meaning: a face with no `role` is what it was. (2) Every bundle written before it is admitted and
// drawn as before: a lane whose connection face is labelled Connection is still read as the connection by that label, the convention the marker replaces and the host keeps for the plugins built before it (`connectionName.test.ts` keeps the
// reading, and `PluginHost.names.test.tsx` runs a window with one). (3) Rule (3) cannot be kept by the letter for a new member, as for `keywords`: admission does not read a lane (a hook answers it anew on every render), so a host that
// predates the marker draws a marked face as a face and has no other name for the connection. A lane that marks a face is read by the mark alone (a face labelled Connection beside it is not the connection), a marked face with no text
// says no connection, and a face that is not valid is not the connection and costs the page nothing else.
//
// The list's default sort (K3a) is minor, on the terms of the connection marker: `defaultSort` is a NEW optional member of a list page's definition (`ListPageDefinition`), a column of its `columns` and a direction, which the page opens in and
// says in the header of that column (`aria-sort`). What makes a header sort at all is the column's own `sortKey`, a member of the kit's column type that a list was always free to declare and that the host did not act on until this step: the
// list page passed no sort to the table, so no header of any plugin's list had a button (the demo's D1). (1) Nothing that exists is removed, renamed or given another meaning: a definition with no `defaultSort` is drawn in the source's order, as it was,
// and a header has a button only where its column declares a key. (2) Every bundle written before it is admitted and drawn as before, but for the one thing the host now does with a member that was always there: a column that declares a key has the
// button the key was written for (no plugin of the new UI declared one before this step; `ListPage.sort.test.tsx` keeps a definition with neither, and `PluginHost.sort.test.tsx` runs a plugin whose list has no key and no default: no button, no
// `aria-sort`, the source's order). (3) Rule (3) cannot be kept by the letter for a new member, as for `keywords`: admission reads a list's definition only for what it needs to draw the page, so a host that predates `defaultSort` admits a bundle that
// gives one and draws its list unsorted (it passes no sort to the table, so no header has a button whatever its columns declare); nothing is refused, and a bundle is never drawn wrong (`admit.test.ts` shows the member is the only difference
// between a definition of either contract, and that each is the other's in types). The page reads `defaultSort` where it is used and never refuses for it: one that names a column that does not sort (no such column, or one with no `sortKey`) is
// no default, and the list is drawn in the source's order. The sort a person chose is the page's own, kept in the tab's page state for the window to give back (`ui-next/page/memory.ts`); a plugin never writes it.
//
// The ports handle (PF1) is minor, on the terms of the panel handle: `PanelHostV1.ports` is a NEW optional member of the handle the HOST fills in, and what it holds is how a plugin's page asks the host to forward a port of one of its
// resources to this computer, `ctx.panel?.ports?.forward(request)`. (1) Nothing that exists is removed, renamed or given another meaning: `PanelHostV1` is what it was and one member more, so a handle written without it (a test's, a
// plugin's own stand-in) is still a `PanelHostV1`, and so is a context, or a command's context, with no handle at all (`contract/ports.test.ts` proves both with the compiler). (2) Every bundle written before it is admitted and drawn as
// before: a hook that never reads `ctx.panel.ports` is unchanged, and admission reads nothing of it, because the handle is not in the artifact. (3) Rule (3) turns round exactly as it does for the panel handle: a host that lacks the
// member leaves `ctx.panel.ports` absent, and so does a window with no port-forward service, and so does a handle made for no connection (a page that is read in none, and a command of the palette: a member that could only refuse is
// worse than one that is absent), so a plugin that offers a forward tests for it, `ctx.panel?.ports?.forward(...)`, and a command may say why it is unavailable; no bundle is drawn wrong, because a page has the member or has not. What
// the host fills in is what the page's own scope already says: the plugin that asks and the connection the page is read in (`ContextV1.route.connection`), so a page forwards in its own connection and in no other, whatever its request
// carries. What the plugin is answered is a forward it can read and stop (`PortForwardSessionV1`), and what it is refused with is a `PortForwardErrorV1`: the host's own code and plain words, never a stack and never raw JSON. How long a forward
// lives, which rules a call is held to (a user action; the bounds on the request; the caps on what a plugin and a window may hold), what address it is reached at (none unless the producer states one) and which codes a refusal has are written where the
// member is (`PanelHostV1.ports`, `PortForwardRequestV1`, `PortForwardSessionV1`, `PortForwardErrorCodeV1`), and a change to any of them is a change to this contract. The rules of a call were written before any plugin used the member, because
// a rule can only be tightened while nothing depends on it (a plugin that calls from an effect, or that holds many forwards, would break) and loosening one never breaks a plugin. For the same reason `localHost` of the answer became optional,
// and `limit` of a refusal was added as an optional member, then.
//
// The overview page (HM3) is minor, on the terms of the detail page, the other kind of page version 1 gained after its first release: `overview` is a NEW kind of page (`OverviewPageV1`, a member of the `PageV1` union) and optional, and a contribution that has none is what it was.
// It is the page of a SCOPE, a connection, where a detail page is the page of an object: it draws the detail page's anatomy (the page header, the in-page tabs and the Overview's typed summary and sections, with the connection's NAME as the heading) for the connection the
// route names, so that a plugin can land a freshly opened connection on a page about the connection itself. A detail page cannot be that, because it needs an object (admission refuses it as `home` and as an entry of the sidebar); an overview page needs none, takes no route
// parameters, and may be both. (1) It is new, and nothing that exists is removed, renamed or given another meaning: its hook answers what a detail page's hook answers (`DetailPageViewV1`), no kind of section and no type of view is added, and a list page and a detail page are read and drawn
// exactly as they were. (2) Every bundle written before it is admitted and drawn as before (`admit.test.ts` keeps one with list pages only and one with a detail page, and the tests of every other kind of page are unchanged). (3) A host that lacks it refuses a bundle that uses it by name, at
// admission, from the artifact: its check reads a page's `kind` as `list` or `detail` and nothing else, so it answers `pages.<id>.kind is "overview", and this version draws "list" and "detail" pages`. That is a `ContractError`, which the loader reports as the `contract` failure ("This plugin does
// not describe its pages in a way this version understands", the problems in its detail), R11's refusal on proof of mismatch: a typed refusal, never a crash, and the page is never drawn wrong. The cost falls on the plugin's whole contribution on that host, as it did for the detail page: a plugin that
// makes the overview its `home` has no list-only contribution to give a host that predates the kind, and a second export would have meant two builds of one plugin for hosts that, on the feature channel, update together with their plugins.
//
// What an overview page says, and what it shares with the detail page (HM3, from the review of #724). Three things are called `overview` and they are three: the PAGE KIND (`kind: 'overview'`, a member of `PageV1`: the page of a scope), the IN-PAGE TAB a plugin names by its own id
// (`tabs: [{ id: 'overview', label: 'Overview' }]`: an id is the plugin's own word, the host reads no meaning from it, and `metrics` or `status` would do as well), and `DetailTabContent.kind: 'overview'` (the typed content a tab may hold, a summary line and sections the page lays out, as against
// `custom`: it is the OVERVIEW OF A TAB, and any tab of any detail page or overview page may hold it). None implies another: an overview page's first tab may be called `overview` and hold `custom` content, and a detail page has the typed content in its first tab. AN OVERVIEW FOLLOWS THE DETAIL VIEW: a
// change to the detail view's types (`DetailPageViewV1`, `DetailView`, `DetailSource`, `DetailState`, `DetailSection`, `DetailTab`, the tile) reaches overviews, because an overview page is drawn by the detail page and its hook answers the detail page's view (`OverviewPageV1.usePage` returns
// `DetailPageViewV1`). That is the point of the reuse, and nobody should change one believing it is the other's alone: a change of that kind is judged for both kinds, by the rule above.
//
// No fake zeros (the rule of the Overview's sections, which an overview page is made of). A section states loading, partial, failed or not available; a plugin never draws a zero, a dash or `None` for a read that has not answered or has failed. An overview is the aggregate of independent reads, so a
// partial failure is its normal failure, and every plugin has to say it. What the PAGE says is one state for the whole page (`DetailState`: loading, ready, not found, denied, failed: it replaces the body, or, once a view is on screen, is a failed Refresh in the header's slot) and nothing of any one section. A
// section's own state is the plugin's own words IN THE SECTION, in its rows and its cells, its `count` and its `action` (a Retry on the section): a count that is still being read says it is, a list built from some of the reads says which it lacks, a read that failed says that it failed and, where asking again
// helps, offers the way. The kit's `MissingValue` is the dash of a value that does not apply and never the answer for a read that failed. The host cannot enforce this rule, because it cannot know what a read is; what it does enforce is that a section cannot take the page with it. A section that throws while it
// draws, or whose rows or items are not a list, is that section's card saying `<title> failed to display.` with a Retry, and the header, the summary and every other section stay (`SectionBoundary`, `ui-next/page`).
//
// Everything a plugin may use at run time is the shared list (`../loader/specifiers.ts`): React, the kit and, with the curated runtime entry, the
// data hooks. A contribution is plain data and functions; it never reaches into the shell's DOM and never imports the host.

/**
 * A node of the sidebar's tree: an entry (a leaf) or a group (it has `children`). The id of a leaf is the id of the page it opens.
 *
 * `keywords` (C1e) are the other names the entry's page is known by, which its label does not say: the short name a tool gives the thing (`ws` for Workshops, `rk` for Racks), or its kind written out. The window's palette
 * finds the page by them as it finds it by its label: typed whole, a keyword ranks the page with an exact match on its label, and typed as the start of one, with a prefix of it; nothing of them is drawn. A keyword is
 * one word (no white space) of 1 to 32 characters; at most eight are read, and one that is not valid is left out with a problem for the plugin's author (`sidebarKeywords.ts`). The keywords of a group are not read.
 */
export type SidebarNodeV1 = Omit<ShellTreeNode, 'children'> & {
  readonly keywords?: readonly string[] | undefined;
  readonly children?: readonly SidebarNodeV1[];
};

/**
 * Where the host asks a contribution to show itself. `connection` is the scope the user chose; it is absent until one is chosen. `params` are the route's other parameters, strings: empty
 * for a list page and for an overview page, the object's identity for a detail page (`connection` is not repeated in them).
 */
export type RouteV1 = {
  /** A key of `ContributionV1.pages`. */
  readonly page: string;
  readonly connection?: string | undefined;
  readonly params: Readonly<Record<string, string>>;
};

/** What the host tells a contribution's hooks: which plugin it is (the id it is installed under), the route it is shown for and, on a host that has it, what the plugin may ask of the window's bottom panel. */
export type ContextV1 = {
  readonly plugin: string;
  readonly route: RouteV1;
  /** What the plugin asks of the bottom panel (P1b-3a). Absent on a host that predates it: a plugin that needs it tests for it. A hook and a command's callback both close over the context, so both reach it. */
  readonly panel?: PanelHostV1 | undefined;
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

/**
 * What a detail page's data hook answers: the object's source (its state, and the view while it is read) and, once the plugin has them, the faces of the scope lane. The host draws both. An overview page's hook answers it too (`OverviewPageV1`), so what this type says is what an overview says: a
 * change to it reaches overviews (the rule above, "an overview follows the detail view"). The state is ONE state, for the whole page; a section's own loading, partial, failed or not available is the plugin's own words in the section (the rule above, "no fake zeros").
 */
export type DetailPageViewV1 = {
  /** At most two faces (ch16 S10). Absent or empty: no lane. The tab's title, the status bar's path and the tab's glyph are not here: they come from the route and the definition (`ui-next/page/detailIdentity.ts`). */
  readonly scope?: readonly ShellScopeFace[] | undefined;
  readonly source: DetailSource;
};

/**
 * A detail page (added to version 1 by D1a, see the rule above): the page of ONE object. A route names it by a page id and the object's identity as string parameters
 * (`definition.identity`), the tab is called `{name} · {Kind}` with the shortest qualifier, and the host draws the page header, the in-page tabs and the Overview's typed sections
 * from the static `definition` and what the one data hook answers. The host calls `usePage` unconditionally, in a component keyed by the route, inside the page's own error boundary,
 * with the route's parameters in `context.route.params`. It has no sidebar entry (it needs an object): it is reached by a link, and `home` is never a detail page (the page of a connection, which needs no object, is an overview page).
 */
export type DetailPageV1 = {
  readonly kind: 'detail';
  readonly definition: DetailPageDefinition;
  readonly usePage: (context: ContextV1) => DetailPageViewV1;
};

/**
 * What an overview page's static definition says (HM3): the words and the tile its header and its tab are drawn from before any data is read, and its in-page tabs. There is no `identity` (the route names a scope, not an object, and the heading is the connection's name),
 * no `list` (nothing leads back above a page that is a landing) and no `kind`: the page is named by its `title`. The tile and the tabs are a detail page's, member for member (`DetailTab`), so a change to either reaches both kinds. A tab's `id` is the plugin's own word for it ("overview",
 * "metrics"), whatever the page kind is called: the page kind, an in-page tab and `DetailTabContent.kind: 'overview'` are three things (the rule above).
 */
export type OverviewPageDefinition = {
  /**
   * The page's name in the sidebar's words ("Overview"): the title of the tab, the heading while the route names no connection (a page that is read in a connection says that connection's name instead), and the word of the page's states
   * ("Loading", "Couldn't load north").
   */
  readonly title: string;
  /** The tile of the page, before the heading: it is the tab's glyph as well. */
  readonly tile: DetailPageDefinition['tile'];
  /** The page's tabs, in order, at least one: the first opens first. The strip is drawn from this before any data is read, so nothing moves when the data arrives. */
  readonly tabs: readonly DetailTab[];
};

/**
 * An overview page (added to version 1 by HM3, see the rule above): the page of a SCOPE, a connection, drawn with the anatomy of a detail page: the page header (its heading is the connection's NAME), the in-page tabs and the Overview's typed summary and sections from the static
 * `definition` and what the one data hook answers. A freshly opened connection lands on it when the plugin makes it `home`. The host calls `usePage` unconditionally, in a component keyed by the route, inside the page's own error boundary, with the route's connection in
 * `context.route.connection` and no parameters (`context.route.params` is empty), and reads what a detail page's hook answers (`DetailPageViewV1`): the source (its state, and the view while it is read) and the faces of the scope lane. The connection's name is the one the lane says (the face marked
 * `role: 'connection'`, `FrameV1`'s `ShellScopeFace`), else the one the window has learned for it; the key the route carries is drawn nowhere. The tab is called `definition.title` and wears the tile's glyph, and the status bar's path is the plugin's name and the connection's. A host that predates the
 * kind refuses the bundle at admission, by naming the kind (the rule above).
 *
 * An overview follows the detail view: the page, its view and its sections are the detail page's, so a change to the detail view's types reaches overviews. And it is the aggregate of independent reads: the page's `DetailState` is one state for the whole page, so a section says its own loading, partial,
 * failed or not available in its own words, and never draws a zero, a dash or `None` for a read that has not answered or has failed (the rule above, "no fake zeros"). A section that cannot be drawn says `<title> failed to display.` with a Retry, in its own card, and the rest of the page stays.
 */
export type OverviewPageV1 = {
  readonly kind: 'overview';
  readonly definition: OverviewPageDefinition;
  readonly usePage: (context: ContextV1) => DetailPageViewV1;
};

/**
 * What the host tells the sidebar's data hook: the context every hook of the plugin gets, and which groups of the sidebar's tree are open (Q2a).
 */
export type SidebarContextV1 = ContextV1 & {
  /**
   * The ids of the groups of the tree that are open on screen, sorted: the entries of an open group are on screen and those of a closed one are not, so a hook that reads something for each entry (what it counts) has a
   * reason to read it only for the entries of these groups, and of the entries that have no group. A group inside a closed group is not listed: none of its entries is on screen. Empty until the tree is on screen, and
   * again when it is not (the rail shows another plugin's sidebar). The list is the same array for as long as the set of groups is the same, and the context is the same object for as long as it and the route are, so
   * a hook may use either as a dependency and is not run again by a render of the host.
   */
  readonly open: readonly string[];
};

/**
 * The sidebar: its words and a static skeleton that draws before any data is read, and optionally a hook for what depends on the connection.
 * While the hook answers `undefined` the skeleton stays; an array replaces it. A hook that throws leaves the skeleton and the failure in the
 * sidebar's own boundary. An entry's `count` is a number, an approximate count (`{ value, approximate: true }`), or `null`: a count is expected, draw nothing yet (the entry has the count slot and no number to draw in it):
 * the slot is held at the width of a count, so a skeleton that declares `null` on the entries that will have a count draws them with no number and no shift, and a number that arrives moves no label.
 */
export type SidebarV1 = {
  /** Names the navigation landmark and its tree. */
  readonly label: string;
  /** The title of the sidebar's header. */
  readonly title: string;
  readonly nodes: readonly SidebarNodeV1[];
  readonly useNodes?: ((context: SidebarContextV1) => readonly SidebarNodeV1[] | undefined) | undefined;
};

/**
 * A page of any kind and any row type. The host holds pages of different row types in one record, and each page's definition and hook are typed together where the
 * plugin writes them (`satisfies ListPageV1<Row>`, `satisfies DetailPageV1`, `satisfies OverviewPageV1`), so the record erases the row type in this one place.
 */
export type PageV1 = ListPageV1<any> | DetailPageV1 | OverviewPageV1;

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

/** The state of a panel session, as the host tells a body and a card (ch16 section H): `ended` is a session that finished or was ended, its output kept; `failed` could not start or broke. */
export type PanelSessionStateV1 = 'starting' | 'running' | 'ended' | 'failed';

/** A panel session as a plugin's body and card read it: a record the host holds, never a connection. */
export type PanelSessionV1 = {
  readonly id: string;
  /** The id the panel knows the tool by: `<plugin id>:<tool id>` for a tool of the plugin's own, a host tool's plain id otherwise. */
  readonly tool: string;
  /** What the tab is called. */
  readonly title: string;
  /** The muted qualifier after the title; empty when there is none. */
  readonly scope: string;
  readonly state: PanelSessionStateV1;
  /** When it entered its state, in epoch milliseconds. */
  readonly since: number;
  /** Why it ended or failed, in a sentence; empty while it runs. */
  readonly cause: string;
  /** The resource the session belongs to, a page of the plugin that opened it. */
  readonly route?: RouteV1 | undefined;
};

/** What a body of a tool of the plugin's own is given. A body that streams keeps its buffer while hidden (`visible` false) and may skip the work only a visible body needs. */
export type PanelBodyPropsV1 = {
  readonly session: PanelSessionV1;
  /** The panel is open and this body is the one on screen. A hidden body is not laid out and not painted; its effects keep running, because its session does. */
  readonly visible: boolean;
};

/** A session started from the plugin's tool, `+` in the header or the button of an empty tool. */
export type PanelSessionOpenV1 = {
  readonly title: string;
  readonly scope?: string | undefined;
  readonly route?: RouteV1 | undefined;
  /** Where it starts. Default: `starting`. */
  readonly state?: PanelSessionStateV1 | undefined;
  /** Why, for a session that opens ended or failed. */
  readonly cause?: string | undefined;
};

/** An action of a card: a button. The host shows at most two buttons in all, `Open <resource>` first when the card names a resource with a route. */
export type PanelCardActionV1 = {
  readonly label: string;
  readonly icon?: IconName | undefined;
  readonly onSelect: () => void;
  /** Why the action is unavailable now; the button stays, with this as its reason. */
  readonly disabledReason?: string | undefined;
};

/**
 * What the card of a session says on hover and keyboard focus (ch16 SCD1): the kind of session, the resource it belongs to as a link, a compact list of facts, what it is doing and since
 * when, at most two actions. Every member is optional: a session whose plugin says nothing gets the host's own card. A failed session's card shows its reason and never Stop: nothing is running.
 */
export type PanelCardV1 = {
  /** What kind of session it is ("Logs", "Shell"). Default: the tool's label. */
  readonly kind?: string | undefined;
  readonly icon?: IconName | undefined;
  /** The resource, by its whole display text ("Item orders-api-7d8c6f49b-f8q4m"): a link when it has a `route`, which opens the page through the tab model. */
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: IconName | undefined; readonly route?: RouteV1 | undefined } | undefined;
  /** The rows between the resource and the state: a label and its text. A fact with no text is left out. */
  readonly facts?: ReadonlyArray<readonly [label: string, text: string]> | undefined;
  /** The plugin's words for the state ("Streaming") and, for a failure, the cause and the next step in one or two sentences. Default: the state's own word and the session's cause. */
  readonly state?: { readonly label?: string | undefined; readonly reason?: string | undefined } | undefined;
  readonly actions?: readonly PanelCardActionV1[] | undefined;
};

/** A tool of the plugin's own in the bottom panel. The host draws the chrome (the tab, the strip of sessions, the card, the close control, the empty state); the plugin draws the body. */
export type PanelToolV1 = {
  /** The tab's text and accessible name: one or two words. */
  readonly label: string;
  readonly icon: IconName;
  /** Where the tab sits among the tools, lowest first. A finite number. */
  readonly order?: number | undefined;
  /** Draws a session of this tool. The host calls it for every session whose body is mounted, inside the tool's own error boundary: a body that throws takes that body down and no other. */
  readonly Body: (props: PanelBodyPropsV1) => ReactNode;
  /** What the card of a session of this tool says. Absent: the host's own card. */
  readonly card?: ((session: PanelSessionV1) => PanelCardV1 | undefined) | undefined;
  /** How a session starts from the tool: the label of the `+` and of the button an empty tool shows, and what opens. `undefined` from `open` opens nothing. Absent: the tool has no `+`. */
  readonly newSession?: { readonly label: string; readonly open: () => PanelSessionOpenV1 | undefined } | undefined;
};

/** How the card of a session this plugin opened in a tool of the HOST reads. The body of a host tool is the host's. */
export type PanelSessionsV1 = {
  readonly card?: ((session: PanelSessionV1) => PanelCardV1 | undefined) | undefined;
};

/** What a plugin brings to the bottom panel. At most two tools of its own (ch16 S114); the sessions it opens in a tool of the host, by the host tool's id. */
export type PanelV1 = {
  readonly tools?: Readonly<Record<string, PanelToolV1>> | undefined;
  readonly sessions?: Readonly<Record<string, PanelSessionsV1>> | undefined;
};

/** A source a feed has heard of, as far as the card names it: its id (what a line's `source` says; `orders-api/app`) and the labels the backend gave it. */
export type LogFeedSourceV1 = {
  readonly id: string;
  readonly labels?: Readonly<Record<string, string>> | undefined;
};

/** The status of a feed: the kit's, and the sources it lists when it can (`openLogStream`'s snapshot does; a feed that lists none says nothing of them). The same object until something in it changes. */
export type LogFeedSnapshotV1 = LogFeedSnapshot & {
  readonly sources?: readonly LogFeedSourceV1[] | undefined;
};

/**
 * What a plugin hands the host to read a log session from: the kit's `LogFeed` and a `close`. `openLogStream(...)` from `@omniviewdev/runtime/ui/v1` returns one as it is (a type test proves it:
 * `logFeed.test.ts`), so for a real plugin there is nothing to adapt. The host reads it with the kit's log view, a frame at a time, and calls `close` when the session's tab closes or its plugin
 * unloads: `close` releases every listener and what the feed holds in the backend. A `close` that rejects is logged; the feed is closed either way.
 */
export type LogFeedV1 = Pick<LogFeed, 'subscribe' | 'read' | 'stats' | 'pause' | 'resume'> & {
  readonly getSnapshot: () => LogFeedSnapshotV1;
  readonly close: () => Promise<void> | void;
};

/**
 * A log session a plugin asks the host to open: owner decision A20. A session starts from the resource, a plugin's page or command; a panel-side picker is deferred, and when it comes it lists
 * descriptors like this one and calls the same function. So this is plain data and one function, which a registry can hold, list and call again. Everything else is the host's: the tab, the card, the
 * words of the state, the lifecycle.
 */
export type LogTargetV1 = {
  /** Names what is read, as the plugin knows it, and is the same each time the same thing is opened (`item/orders-api/app`): a registry lists by it, comparing it exactly as given. With the plugin it is the session's identity (A22): a target whose session is starting or running is shown, not opened again, and the host answers that session even when it has nowhere to show it. */
  readonly id: string;
  /** What the tab is called. The shell cuts a long one (SCT1): a head that gives way with an ellipsis and a tail that stays whole, so what tells sessions apart goes last (`orders-api/app`). */
  readonly title: string;
  /** The muted qualifier after the title: the connection two sessions of one name are told apart by. */
  readonly scope?: string | undefined;
  /** The resource the lines belong to: its whole display text ("Item orders-api"), the word of the card's button ("Item" makes "Open Item") and its page, a link in the card that opens through the tab model. */
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: IconName | undefined; readonly route?: RouteV1 | undefined } | undefined;
  /** Starts the stream, once, when the host opens the session. A throw opens no session and is logged. For a real plugin: `() => openLogStream({ ... })`. */
  readonly open: () => LogFeedV1;
};

/** A session the host opened for a plugin. */
export type LogSessionV1 = {
  /** The id the panel knows the session by. */
  readonly id: string;
  /** Closes the session's tab, and with it the stream. Safe to call again. */
  readonly close: () => void;
};

/**
 * What a plugin's page asks the host to forward (PF1): one port of one resource, to a port of this computer. The plugin says WHICH resource and WHICH ports; the host says the rest. The plugin that asks and the connection are not in the
 * request: the host fills them in from the page's own scope (the plugin's id, and `ContextV1.route.connection`), so a page forwards in its own connection and in no other. The members after the resource's id are the ones the plugin's
 * forwarder reads, written as the runtime's typed start has them (`NetworkerClient.StartResourcePortForwardingSession`): a plugin that holds a `ResourceReference` of the resource, or its body, hands them over as they are. The request has no
 * `route`: the host's networker admits a reference only with a route of the connection the forward is started in, which is the page's, so the host writes that route itself whenever there is a reference. A member this type does not list is not read.
 *
 * THE BOUNDS (PF2). Every text of the request and its size are bounded, and a request over a bound is refused `INVALID_REQUEST`, in words that name the member and the number, before the plugin's forwarder is asked: `resourceId` at most 1024
 * characters, `resourceKey` at most 256, every text in `reference` (a value or a name) at most 1024, `resourceData` at most 64 KiB as the JSON it is sent as (UTF-8) and the whole request, as the host sends it, at most 128 KiB. A value that nests
 * more than 64 levels deep, which one that refers to itself does, is refused too. A text is counted in characters and the sizes in the bytes of the JSON; the host measures without serialising what is far too large.
 */
export type PortForwardRequestV1 = {
  /** The resource whose port is forwarded, by the id the plugin knows it by. A blank id is refused, and so is one of more than 1024 characters. */
  readonly resourceId: string;
  /** The plugin's key for the kind of resource it is, which says which of its forwarders takes the request. Absent: the empty key, which only a forwarder registered under it takes. At most 256 characters. */
  readonly resourceKey?: string | undefined;
  /** The resource's reference, when the plugin holds one. The host's networker admits it only for the connection the forward is started in, which is the page's own: the host writes the route that says so. Every text in it is at most 1024 characters. */
  readonly reference?: ResourceReference | undefined;
  /** The resource's body, for a forwarder that reads it. At most 64 KiB as the JSON it is sent as, and no more than 64 levels deep. */
  readonly resourceData?: Value | undefined;
  /** The port of the resource to forward: a whole number from 1 to 65535. */
  readonly remotePort: number;
  /** The port on this computer: a whole number from 1 to 65535. Absent: the host takes a free one (0 is not a way to say so: it is refused). */
  readonly localPort?: number | undefined;
  /** The transport. Absent: TCP. */
  readonly protocol?: 'TCP' | 'UDP' | undefined;
};

/**
 * A forward the host started for a plugin (PF1), as the page that asked holds it. The forward is the HOST's, not the page's: how long it lives is written at `PanelHostV1.ports`. The answer is frozen. `sessionId` and `localPort` are what the
 * host's session states; `localHost` is there only when the producer states it, and is written so below.
 */
export type PortForwardSessionV1 = {
  /** The id the host and the Ports tool know the forward by. */
  readonly sessionId: string;
  /**
   * The port on this computer that the forward listens on, as the host's session states it (its `local_port`): the port the plugin asked for, or the free one the host took when it asked for none, which is how a plugin learns it. A
   * whole number from 1 to 65535. A forward that the host started and did not state a port for is not answered: it is stopped, and the call is refused.
   */
  readonly localPort: number;
  /**
   * The host the forward listens on, present ONLY when the producer states it (the SDK's `local_host`, from plugin-sdk v0.23.0: an IP address or `localhost`; empty is unknown and the member is absent, a plugin must not read an address into its
   * absence). The host passes it on as stated and reads nothing into it. A plugin takes the forward as reachable only from this computer if and only if the value is `localhost` (ASCII, any case) or an IP address that is loopback once an IPv4-mapped
   * IPv6 address is unmapped (127.0.0.0/8, ::1, ::ffff:127.x.y.z); `0.0.0.0`, `::`, a LAN or a link-local address are reachable from other computers. The Ports tool says a host in its rows in the same way: only when the session carries one.
   */
  readonly localHost?: string | undefined;
  /**
   * Stops this forward: the host closes its session (`ClosePortForwardSession`), which ends the tunnel and removes the forward from the host's list and from the Ports tool. It closes the session the forward was answered with, by that session's
   * id, and asks the host once: a second call, and one made while the first is under way, is the first's outcome (it resolves when the first did, and rejects with the same error when it did not). It resolves for a forward the host no longer has
   * too (the person stopped it in the Ports tool, or another window did): what a caller wants is that it does not run. It rejects with a `PortForwardErrorV1` when the host cannot close it, as it does for a forward whose plugin has stopped
   * (`NOT_FOUND`: the plugin is not there). The host closes by the id alone, and the SDK gives every session a fresh UUID, so the id names this forward and no other. A forwarder that chose ids of its own (the SDK lets it; none we have does) and
   * gave one out twice would let a handle that outlived its forward close the later one: the host's index is overwritten by a later session of the same id, and a handle cannot check what the host does not state. That is a gap of the host and the
   * SDK, and not of this contract's shape. It is the page's way to clean up after what it started, as the `close` of a Logs session is, and nothing calls it for the page (see `PanelHostV1.ports`).
   */
  readonly stop: () => Promise<void>;
};

/**
 * The classes of refusal a forward meets (PF1). A code is the host's own when the host's answer has one (the classes of `backend/pkg/apperror`, which the plugin's SDK uses too, read as the runtime's `parseAppError` reads them), and
 * `INVALID_REQUEST` is also what the host says of what it refuses itself, before it asks anything. `ALREADY_EXISTS` is said as `CONFLICT` and `CERTIFICATE_ERROR` as `CONNECTION_ERROR`, because the host's own classes put them together; a
 * class a forward does not meet (an expired traversal, a reset, an incomplete result) and a code a later host adds are `UNKNOWN`, as is an answer that carries no code and has no type to read one from. A plugin that tells one class from
 * another uses a `switch`, with a `default` for the codes it does not act on. The examples below of which refusal arrives as which code (a port in use, a privileged port, UDP, a connection that is not started) were measured on the real host by
 * the review of the host's PR #710, and are not read from the host's Go [INFERENCE].
 */
export type PortForwardErrorCodeV1 =
  /** The request is not one the host or the plugin's forwarder takes: no resource, a port that is not a whole number from 1 to 65535, a protocol that is not TCP or UDP, a text or a body over the host's bounds (the host refuses these itself, in words that name the member and the number: the request's size, a resource id of more than 1024 characters), or one the forwarder does not take (UDP, for a TCP forwarder). */
  | 'INVALID_REQUEST'
  /** The plugin cannot forward ports. */
  | 'UNSUPPORTED'
  /** Access to the resource or the connection is refused, or the call was not made from a user action (a click or a key press): a forward cannot be started from a render, an effect or a timer, and a window whose engine cannot tell the two apart cannot start one. */
  | 'FORBIDDEN'
  /** The connection needs the person to sign in. */
  | 'UNAUTHORIZED'
  /** The host has no such plugin, connection or resource. */
  | 'NOT_FOUND'
  /** The request conflicts with the current state. */
  | 'CONFLICT'
  /** The call was cancelled before the host answered. */
  | 'CANCELLED'
  /** The host or the plugin did not answer in time. */
  | 'TIMEOUT'
  /** The source could not be reached, or the port could not be opened: a privileged port that the system refuses is one. */
  | 'UNAVAILABLE'
  /** The connection is not started, or could not be verified: starting it is what helps. */
  | 'CONNECTION_ERROR'
  /** The request is over a limit: the host's (such as the size of the resource's body), or the window's cap on the forwards a plugin may hold (`limit` of the refusal says the number). */
  | 'RESOURCE_LIMIT'
  /** The plugin's forwarder could not do it, and the host does not say why: a local port that is in use and a resource that no forwarder takes both arrive as this code (a gap of the producer's, which states no more than the class). */
  | 'PROVIDER_ERROR'
  /** The host failed in a way it did not classify. */
  | 'INTERNAL'
  /** The answer has none of the codes above: one that could not be read as an error of the host's, or a class a later host adds. */
  | 'UNKNOWN';

/**
 * What `ports.forward` and a forward's `stop` reject with when they cannot do what was asked (PF1): an `Error` named `PortForwardError`, whose `code` is the class of refusal (`PortForwardErrorCodeV1`), whose `message` is plain words for a
 * person (one sentence: never a stack, a page of output or the host's raw JSON) and whose `cause` is what the host's call rejected with, as the runtime delivered it, for a plugin author to log. A rejection is the only way either call
 * fails: neither throws into the page. The class is the host's, and a plugin cannot import it, so a page tells the error by its name and reads it as this type:
 * `if (error instanceof Error && error.name === 'PortForwardError') { const refusal = error as PortForwardErrorV1; ... refusal.code ... }`.
 */
export type PortForwardErrorV1 = Error & {
  readonly name: 'PortForwardError';
  readonly code: PortForwardErrorCodeV1;
  readonly cause?: unknown;
  /**
   * The number the refusal is about, when the host's own count is what refused: for `RESOURCE_LIMIT` from the window's cap, how many forwards the plugin may hold in the connection (64) or the window in all (128); the message says it in
   * words too. Absent for every other refusal, and for a `RESOURCE_LIMIT` that is the host's own (the size of a body, for instance), which states no number the window knows.
   */
  readonly limit?: number | undefined;
};

/**
 * What a plugin asks of the window's bottom panel. Call it from a user's action on a resource (a command, a click), as owner decision A20 has it, and not from an effect while a page mounts: the panel learns
 * that a plugin is live after the page's own first effects have run, so a call made there is refused. `logs.open` opens a session in the host's Logs tool for a target and answers it, or `undefined` when the host could not (the plugin is not live,
 * the target is not well formed, its `open` threw): the reason is in the console. The panel opens on the new session, as it does for any session the user starts. A target whose session is starting or running is not opened again (A22): that session is answered and `open` is not called, and the panel shows it when it can: a returned handle is the session's, not proof that it is on screen (the host's Logs tool may be gone).
 *
 * The handle is the plugin's and, for `ports`, the connection's too, and every page of that plugin in that connection is given the same one: it and each member it holds are frozen, so a page cannot replace a member for the others.
 */
export type PanelHostV1 = {
  readonly logs: { readonly open: (target: LogTargetV1) => LogSessionV1 | undefined };
  /**
   * PF1, PF2. `forward` forwards a port of one of the plugin's resources to this computer and answers the forward (`PortForwardSessionV1`: its id, the port it listens on and a way to stop it, and the address when the producer states one) once the
   * host has started it, and the Ports tool is shown then. It is bound to the plugin and to the connection the page is read in, and fills both in: the request names neither. It rejects with a `PortForwardErrorV1`, in the host's own code and plain
   * words, when the call is not from a user action, when the request names no resource, a port that is not a whole number from 1 to 65535 or a protocol that is not TCP or UDP or is over a bound, when the plugin or the window already holds as many
   * forwards as it may, and when the host could not start the forward. The member is absent on a host that predates it, in a window with no port-forward service, and from the handle of a page that is read in no connection and of a palette command
   * (nothing says which connection to forward in): a plugin tests for it, `ctx.panel?.ports?.forward`.
   *
   * FROM A USER ACTION ONLY. A forward is started from a click or a key press, never from a render, an effect, a timer or a message: it starts a listener in the plugin's process. The host asks the engine at the call, before it reads the request
   * or awaits anything (`navigator.userActivation.isActive`), and refuses `FORBIDDEN` when none is under way: 'A forward can only be started from a user action: a click or a key press.' An action's activation lasts about five seconds, so a page
   * that awaits slow work between the click and the call (a read from the network, say) may lose it: call `forward` in the handler, or after work that is short. An engine that cannot tell a user action from a script (it has no `navigator.userActivation`)
   * is refused as well, `FORBIDDEN` with words of its own, 'This window cannot tell a user action from a script, so it cannot start a forward.': the rule is gesture only, so a forward cannot be started in such an engine. `stop()` asks for no user action.
   *
   * THE BOUNDS are written at `PortForwardRequestV1`: a request over one is `INVALID_REQUEST`, and the check is made before anything is asked of the plugin's forwarder.
   *
   * THE CAPS. A plugin may hold 64 forwards in one connection and a window 128 in all. A call that would pass either is refused `RESOURCE_LIMIT` with the cap as the error's `limit` and in words: 'This plugin already holds 64 forwards in this
   * connection. Stop one first.' and 'This window already holds 128 forwards. Stop one first.' (the connection's is said when both are full). The window counts a forward from the call, before the host answers, so calls made while the host is still
   * answering are counted, and it counts it until `stop()` of its answer has closed it, until the host says it is closed (the person stopped it in the Ports tool, or another window did) or until its plugin stops. A forward whose tunnel ended on
   * its own is counted until it is closed, as it stays listed. The count is the WINDOW's: the host has no owner of a forward, so across windows, and across a reload of the page, it cannot say how many a window started, and another window counts
   * its own. The caps bound what one window asks, not what the host holds.
   *
   * THE FORWARD'S LIFETIME. A forward belongs to the HOST, not to the page that asked, the window it was asked in or the plugin code that holds its answer: it outlives the page, a reload of it and every window (nothing in the host's networker
   * releases a forward when a page or a window goes: `backend/pkg/plugin/networker` keeps the plugin's sessions with no owner), and nothing the page does ends it but `stop()`. It ends when
   * - `stop()` of its answer is called, or the person (or any window) stops it in the Ports tool: the host closes the session, which ends the tunnel and removes the forward from its list;
   * - its plugin stops, or the app quits: the host stops every tunnel of a plugin that stops (`OnPluginStop`), and of every plugin at shutdown (`ServiceShutdown`); a host that is killed outright is not covered here;
   * - its connection stops or is retired: the SDK cancels the tunnels of a connection that retires, and the session stays listed as Stopped until it is closed [INFERENCE: what retires a connection is the connection's own, and was not read here];
   * - its tunnel ends on its own or fails: the session stays listed as Stopped or Failed until it is closed, which is why the Ports tool can show it and `stop()` can remove it.
   * This contract has no event for a forward's end: a page that holds a forward cannot hear that it ended, and what it holds may be one that no longer runs.
   */
  readonly ports?: { readonly forward: (request: PortForwardRequestV1) => Promise<PortForwardSessionV1> } | undefined;
};

/** One chip of the chain that narrows a palette search under the plugin's own (ch16 S69): the connection, then a type, then an object. */
export type PaletteChipV1 = {
  readonly kind: 'scope' | 'type' | 'resource';
  /** What the plugin knows the chip by (for a connection, the id a route's `connection` carries). */
  readonly id: string;
  readonly label: string;
};

/**
 * What a palette provider is asked in: plain data, a copy the plugin may keep. The palette asks a plugin's providers when it is searching everywhere and when it is narrowed to that plugin, and never when it is narrowed to
 * another (S69), so `plugin` is the plugin's own id or `null`. `kind` is the filter the user chose under the input: a provider is asked in All, Go to and Commands only.
 */
export type PaletteScopeV1 = {
  /** The id of the plugin the palette is narrowed to, or `null` when it searches everywhere. */
  readonly plugin: string | null;
  /** The chips under the plugin's own, outermost first. Empty when the search is not narrowed below the plugin (or not at all). */
  readonly chips: readonly PaletteChipV1[];
  readonly kind: 'all' | 'goto' | 'commands';
};

/** What a command's argument is made of: JSON, and at most 1,024 characters of it. */
export type PaletteJsonV1 = string | number | boolean | null | readonly PaletteJsonV1[] | { readonly [key: string]: PaletteJsonV1 };

/**
 * A result as data (C1c): what the palette draws and what choosing it does. A row opens ONE of two things: `route`, a page of this plugin (a list page or an overview page with no parameters, or a detail page with the parameter that names
 * its object: the route of a row of another plugin, or of a page the plugin does not have, is not valid), or `command`, one of the commands this plugin registers under `palette.commands`. The host reads each row when it is
 * answered and leaves out one that is not valid, with a problem for its provider: no row is trusted for its type. The lengths are in characters; text is one line (it is trimmed and its white space collapses).
 */
export type PaletteRowV1 = {
  /** Names the row in its provider and is the same each time the same thing is answered: it is what keeps a row focused while the list changes. At most 256 characters, unique in an answer. */
  readonly id: string;
  /** What the row is called, and what a query is matched against. At most 120 characters. */
  readonly label: string;
  /** The muted words after the label: where it is, what it is. They are matched too, by whole words, below the label. At most 160 characters. */
  readonly secondary?: string | undefined;
  /** Words a query also finds the row by that are never drawn (a short name, an alias). At most 200 characters. */
  readonly keywords?: string | undefined;
  /** The row's glyph, a name from the kit's registry. A name the host's kit does not have makes the row not valid. */
  readonly icon: IconName;
  /** A page of this plugin, in its own route space. A list page takes no parameters; a detail page takes the one that names its object. At most 8 parameters (names of 64 characters, values of 256). */
  readonly route?: RouteV1 | undefined;
  /** One of this plugin's commands, by the id it is registered under, with an argument the host copies. */
  readonly command?: { readonly id: string; readonly arg?: PaletteJsonV1 | undefined } | undefined;
};

/**
 * What a `search` provider answers instead of a bare list: the rows, in the provider's own order, and what it knows of the rest. `limited` is how many there are in all when it returns fewer ("first 20 of 5,000"); `partial`
 * says a part of the source did not answer, and `message` (at most 160 characters) says why and what to do next, as a plain sentence the palette shows with the run.
 */
export type PaletteAnswerV1 = {
  readonly rows: readonly PaletteRowV1[];
  readonly limited?: number | undefined;
  readonly partial?: boolean | undefined;
  readonly message?: string | undefined;
};

type PaletteProviderBaseV1 = {
  /** The heading of the provider's section, 40 characters at most. The palette puts the plugin's name before it ("Acme · Widgets") and calls the source by it in its status line. */
  readonly section: string;
  /** Which filter under the input shows the section besides All: Go to (default) or Commands. */
  readonly filter?: 'goto' | 'commands' | undefined;
  /** `false`: the provider has nothing to say in this scope and is not asked. It runs on the palette's own call and must be cheap; one that throws is asked. */
  readonly supports?: ((scope: PaletteScopeV1) => boolean) | undefined;
};

/**
 * A provider for a SMALL set the plugin already holds (its pages, its commands, its kinds): `match` answers the candidates that could answer, and the palette scores, filters and ranks them (a provider may answer its whole list and
 * ignore the query). It runs synchronously on every keystroke while the palette is open and must be cheap; at most 1,000 rows are read. Its rows are pages (or commands, for a row that carries one).
 */
export type PaletteMatchProviderV1 = PaletteProviderBaseV1 & {
  readonly kind: 'match';
  readonly match: (query: string, scope: PaletteScopeV1) => readonly PaletteRowV1[];
};

/**
 * A provider for a set too large to hold, or that lives elsewhere (the objects of a connection): `search` does its own matching and answers the best rows in order. The palette asks it 150 ms after the last keystroke, aborts
 * `signal` when the query moves on or the palette closes (and drops the answer whether or not the provider honours it), gives up on it after 5 seconds, keeps 20 rows, and says how many there were when `limited` does. Its
 * rows are resources (or commands, for a row that carries one), and they are not ranked again: the provider's order is the order shown.
 */
export type PaletteSearchProviderV1 = PaletteProviderBaseV1 & {
  readonly kind: 'search';
  readonly search: (query: string, scope: PaletteScopeV1, signal: AbortSignal) => Promise<readonly PaletteRowV1[] | PaletteAnswerV1>;
};

export type PaletteProviderV1 = PaletteMatchProviderV1 | PaletteSearchProviderV1;

/** What a command's `run` may answer: `false`, or `{ ok: false, reason }` (a plain sentence of at most 160 characters), refuses; the palette stays open and says why. Anything else is done. */
export type PaletteCommandResultV1 = { readonly ok?: boolean | undefined; readonly reason?: string | undefined };

/** What a command is told: the plugin it belongs to, and, on a host that has it, what the plugin may ask of the bottom panel (as `ContextV1.panel`). A command runs from the palette and not from a page, so the handle it is given is read in no connection and has no `ports` member: a member that could only refuse is left out. */
export type PaletteCommandContextV1 = {
  readonly plugin: string;
  readonly panel?: PanelHostV1 | undefined;
};

/**
 * A command of the plugin, run when a palette row that names it is chosen (Enter, with any modifier: a command ignores them, S64). The host looks it up again immediately before it runs, so a plugin that has left, or a command
 * it no longer has, is refused with a reason. A throw or a rejection is the command's failure: the palette stays open and says so in the host's words; the plugin's are in the console.
 */
export type PaletteCommandV1 = {
  readonly run: (arg: PaletteJsonV1 | undefined, context: PaletteCommandContextV1) => void | boolean | PaletteCommandResultV1 | Promise<void | boolean | PaletteCommandResultV1>;
};

/**
 * What a plugin brings to the command palette (C1c, minor: the rule is at the head of this file): providers of results, by id (no colon, at most 64 characters; at most four), and the commands their rows may name. A provider's
 * section is the plugin's own: the palette never mixes two plugins' rows. Absent: nothing.
 */
export type PaletteV1 = {
  readonly providers?: Readonly<Record<string, PaletteProviderV1>> | undefined;
  readonly commands?: Readonly<Record<string, PaletteCommandV1>> | undefined;
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
  /** What the plugin brings to the bottom panel: tools of its own, and the card of the sessions it opens in a tool of the host. Absent: nothing. */
  readonly panel?: PanelV1 | undefined;
  /** What the plugin brings to the command palette: providers of results and the commands their rows may name. Absent: nothing. */
  readonly palette?: PaletteV1 | undefined;
};
