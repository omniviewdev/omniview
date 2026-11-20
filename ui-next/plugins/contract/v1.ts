import type { ReactNode } from 'react';
import type { IconName, LogFeed, LogFeedSnapshot } from '@omniviewdev/kit';
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
  /** Names what is read, as the plugin knows it, and is the same each time the same thing is opened (`item/orders-api/app`): a registry lists by it. With the plugin it is the session's identity (A22): a target whose session is starting or running is shown, not opened again. */
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
 * What a plugin asks of the window's bottom panel. Call it from a user's action on a resource (a command, a click), as owner decision A20 has it, and not from an effect while a page mounts: the panel learns
 * that a plugin is live after the page's own first effects have run, so a call made there is refused. `logs.open` opens a session in the host's Logs tool for a target and answers it, or `undefined` when the host could not (the plugin is not live,
 * the target is not well formed, its `open` threw): the reason is in the console. The panel opens on the new session, as it does for any session the user starts. A target whose session is starting or running is not opened again (A22): that session is shown and answered, and `open` is not called.
 */
export type PanelHostV1 = {
  readonly logs: { readonly open: (target: LogTargetV1) => LogSessionV1 | undefined };
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
};
