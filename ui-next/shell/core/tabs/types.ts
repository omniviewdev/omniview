// The tab and open model of the shell: its data, and the seam it calls through. Plain data only: no React, no DOM, nothing a plugin owns.
// A tab is a route plus restorable state, never DOM (ch16 S16): the shell stores the record and a plugin draws the page from it.
// Every rule cites the design chapter (docs/ui-next/status/S1a.md lists the decisions the design leaves open).

/** Plain JSON: what a route, a reveal request and a page's saved state may hold. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** The members of a route a plugin owns. The shell never reads them: it compares them (canonical order, empty members left out). */
export type Params = Readonly<Record<string, Json>>;

/**
 * Where a tab is, in terms no plugin owns: a plugin, one of the pages (contributions) it offers, and that page's parameters. This
 * object, in canonical form, is what identifies a tab; nothing else of the host knows what a parameter means.
 */
export type Route = {
  readonly plugin: string;
  readonly contribution: string;
  readonly params: Params;
};

/** A route as a caller writes it: `params` may be left out, and a member that is `undefined` is left out. */
export type RouteInput = {
  readonly plugin: string;
  readonly contribution: string;
  readonly params?: Readonly<Record<string, Json | undefined>> | undefined;
};

/** Somewhere to go (ch16 S63): a route, and what the page is asked to show once it draws it (never part of the route, the key or the history). */
export type Destination = {
  readonly route: RouteInput;
  readonly reveal?: Json | undefined;
};

export type TabId = string;

/** The context a page is read in (a connection, an account): the model compares ids and shows the label, at most 24 characters (ch16 S10). */
export type Scope = { readonly id: string; readonly label: string };

/** One step of the status bar's path (ch16 S61); `route` is the place a parent crumb navigates to. */
export type Crumb = { readonly label: string; readonly route?: Route | undefined };

/** A crumb as a plugin describes it: its label alone, or the label with the route it opens. */
export type CrumbInput = string | { readonly label: string; readonly route?: RouteInput | undefined };

/** What a plugin says about a route (ch16 DM1: the closed set `describe(route)` returns). The host reads nothing else. */
export type Description = {
  /** The page's own name: `{name} · {Kind}` for an object (TI1), at most three words for a page (S17). */
  readonly title: string;
  readonly icon?: string | undefined;
  readonly scope?: Scope | undefined;
  /** The status bar's crumbs, root first; the last is the page itself (S61). Empty for a host page. */
  readonly path?: readonly CrumbInput[] | undefined;
  /** The plugin's qualifiers, most to least preferred: from them the model builds the qualifier of a tab that would read like another (TI1). */
  readonly facets?: readonly string[] | undefined;
  /** What the plugin is called, for the tooltip and as the last facet. Absent for a host page. */
  readonly pluginName?: string | undefined;
  /** `none`: a fresh blank view, so every open is a new tab (S26). */
  readonly identity?: 'none' | undefined;
  /** One tab of this page in the whole app (the host's Settings, Plugins, Developer Tools): a singleton beats every disposition (S26). */
  readonly singleton?: boolean | undefined;
  /** The part of the key that says which page this is. Absent: the contribution and its parameters. A plugin leaves out what is not identity (a sub-tab). */
  readonly key?: string | undefined;
  /**
   * A stand-in the host made from what it knows (the plugin's name) because the plugin has not said anything yet: it is still loading. It names a tab that has no face of its own (one opened
   * at the plugin before it loaded), and is never taken for what the plugin says: a tab that already has a face (restored with one, or described by the plugin before) keeps it, as it does when
   * the plugin says nothing.
   */
  readonly provisional?: true | undefined;
};

/** Whether a destination can be opened (ch16 S65). A degraded one opens, to a recovery page; an unavailable one is refused with its reason. */
export type Availability =
  | { readonly state: 'available' }
  | { readonly state: 'degraded'; readonly reason?: string | undefined }
  | { readonly state: 'unavailable'; readonly reason: string };

/**
 * What the model asks of whoever owns the plugins (the plugin host). Every member is synchronous and pure, and a member that throws is
 * isolated: the model falls back and goes on, and `onError` hears of it (ch16 S89: one plugin never breaks the model).
 */
export type Contributions = {
  /** What a plugin says about a route. `undefined`: it says nothing, and the title comes from the route. */
  readonly describe: (route: Route) => Description | undefined;
  /** Default: available. A route no plugin can serve (not installed, disabled, built for another version) is unavailable. */
  readonly availability?: ((route: Route) => Availability) | undefined;
  /**
   * Fills in what a route leaves out, from the route the user is working in (the connection a sidebar entry did not name). Returns the
   * route to open; `undefined` refuses it. It runs before the route is described, so a plugin's defaults are part of its identity.
   */
  readonly complete?: ((route: Route, context: { readonly from: Route | undefined; readonly source: string }) => Route | undefined) | undefined;
  /** Runs on a saved or recently closed tab before it comes back: the plugin may rewrite its route or drop the tab (`false`) (ch16 DM1). */
  readonly restore?: ((route: Route) => Route | false) | undefined;
  /**
   * Runs on the face a saved tab comes back with, whether or not its plugin has said anything yet: the host takes out of it what it must not draw (a build before the names saved a connection's key in it) and may learn from it
   * (the name it holds). Returns the face to keep. A plugin that has said something is described again and its face replaces this one.
   */
  readonly restoreFace?: ((face: Face, route: Route) => Face) | undefined;
  /** The route a window opens with, or a plugin's own first page when given its id. */
  readonly home?: ((plugin?: string) => RouteInput | undefined) | undefined;
  /** Called when what the plugins say changed (one loaded, one left): the model describes its tabs again. */
  readonly subscribe?: ((listener: () => void) => () => void) | undefined;
};

/** A description, normalised: every field present, every string trimmed, the scope label cut at 24 characters. Cached in the tab, saved with it, and drawn before a plugin loads. */
export type Face = {
  readonly title: string;
  readonly icon: string;
  readonly scope?: Scope | undefined;
  readonly path: readonly Crumb[];
  readonly facets: readonly string[];
  readonly pluginName: string;
  readonly singleton: boolean;
  readonly identity: 'key' | 'none';
};

/** Where the page on screen is: all a page host needs to draw a tab's page. It changes when the route does, not when a title does. */
export type Location = {
  readonly route: Route;
  /** `{plugin}:{scope}:{page}`: two tabs with one key show one place (ch16 S26). Derived; recomputed with the face. */
  readonly key: string;
  /** Raised by a reload: a page host that keys its page by `id` and `generation` draws it again. */
  readonly generation: number;
};

/** The routes of a tab's back and forward stack (ch16 S60): at most 50, the current one at `index`. This is all of a history that is saved to disk. */
export type PersistedHistory = { readonly entries: readonly Route[]; readonly index: number };

/**
 * A tab's own back and forward stack (ch16 S60) with what each page kept when the tab LEFT it (H7): a history entry carries the page state of the page it left, and Back and Forward give it back.
 * `states[i]` is that state for `entries[i]`, `null` for a page that kept nothing and ALWAYS `null` at `index`: the page on screen keeps its state in the tab's `pageState`, which is the one place it
 * lives. The member is absent while no page has left anything (a history that saved nothing is the history it always was), and when present it is as long as `entries` and the oldest entry and its
 * state go together at the cap. Each state is at most `LIMITS.pageStateBytes`, so a tab holds at most `LIMITS.history + 1` of them. A closed tab and a saved session hold none: they are for the window's life.
 */
export type History = PersistedHistory & { readonly states?: readonly Json[] | undefined };

export type Attention = false | 'warning' | 'error';

export type Flags = {
  readonly pinned: boolean;
  /** Muted, and replaced by the next preview open (ch16 S24). At most one in the strip. */
  readonly preview: boolean;
  /** The page holds a draft that closing or leaving would discard (ch16 S27). */
  readonly unsaved: boolean;
  /** An operation started here ended badly while the tab was not on screen (ch16 S22). Cleared when the tab is shown. */
  readonly attention: Attention;
};

export type OpenHow = 'smart' | 'here' | 'new' | 'background' | 'window';

/** A request to show something in the page, left by an open for the page host to answer (ch16 K1). Transient: never saved, dropped when the tab leaves its route or closes. */
export type Reveal = {
  /** Unique in the store: answer with `consumeReveal(id, seq)`. */
  readonly seq: number;
  /** The route that was asked for, which may say more than the tab's own (a row, a sub-tab). */
  readonly route: Route;
  readonly payload?: Json | undefined;
  readonly source: string;
  readonly how: OpenHow;
  /** The tab was made by this open. */
  readonly fresh: boolean;
  /** The open moved the tab to another route. */
  readonly navigated: boolean;
};

export type Tab = {
  readonly id: TabId;
  readonly location: Location;
  readonly face: Face;
  readonly history: History;
  readonly flags: Flags;
  /**
   * What the page on screen asked to keep: plain data (what a person chose in it, and where it is scrolled under `scroll`), at most `LIMITS.pageStateBytes`, never saved to disk. It lives with the tab for
   * the window's life: through a switch of tabs, a reload and a reopen. A navigation saves it with the history entry it leaves and starts a clean page, but for a place the tab has been at before,
   * which opens as it was left (not where it was scrolled); Back and Forward give back what the entry they go to kept (H7, `History`).
   */
  readonly pageState: Json;
  readonly reveal?: Reveal | undefined;
};

/** What a closed tab keeps so it can come back (ch16 S30): its place, and the page state of the entry it was on while the window lives. The saved states of its history are dropped with it (H7). */
export type ClosedTab = {
  readonly id: TabId;
  readonly location: Location;
  readonly face: Face;
  readonly history: History;
  readonly pageState: Json;
  readonly pinned: boolean;
  /** Where it was in the strip when it went; reopening puts it back there, clamped. */
  readonly index: number;
};

/**
 * How many pages stay mounted, as data the UI layer reads (ch16 S29, docs/ui-next/optimisations.md HSH-21). The old shell kept every tab it had shown mounted for
 * as long as it was open, with no cap. `cap: null` is that policy; a number is the most pages mounted at once, the one on screen included.
 */
export type KeepAlive = {
  readonly cap: number | null;
  /** A tab with an unsaved draft is never evicted, and does not count toward the cap. */
  readonly keepUnsaved: boolean;
};

export const STATE_VERSION = 1;

export type TabsState = {
  readonly version: typeof STATE_VERSION;
  readonly tabs: Readonly<Record<TabId, Tab>>;
  /** The strip, left to right. Pinned tabs lead: the pinned zone is never interleaved (ch16 S38). This is also the order of the All tabs list (ch16 S49). */
  readonly order: readonly TabId[];
  /** The tab on screen; null while the strip is empty: before the window's home page opens, or after the user closed the last tab (decision A17). */
  readonly active: TabId | null;
  /**
   * The tabs whose page is mounted, most recently shown first; the tab on screen leads (ch16 S29, S32). A tab enters when it is shown, never before (a tab restored or opened in the
   * background has no page); it leaves when it is closed or when `keepAlive` evicts it, the least recently shown first. A tab that left is mounted again only when it is shown again:
   * closing a tab or raising the cap brings nothing back. `selectors.mounted` lists the same tabs in strip order.
   */
  readonly mounted: readonly TabId[];
  /** Newest first, at most 25 (ch16 S30). */
  readonly closed: readonly ClosedTab[];
  readonly keepAlive: KeepAlive;
  /** Counts reveal requests. */
  readonly serial: number;
  /**
   * A tab has been on screen in this window. Until then an empty strip opens the window's home page by itself (the start of a window: ch16 S30, `ensureHome`); from then on an empty strip
   * stays empty, because the user emptied it, and nothing opens a page for them (decision A17: closing the last tab leaves an empty window with a way out, and no page comes back by itself).
   * Not saved: a window restored from tabs has started, and one restored from none has not.
   */
  readonly started: boolean;
};

export const LIMITS = Object.freeze({
  /** Back and forward entries per tab (ch16 S60). */
  history: 50,
  /** History entries saved per tab (ch16 S32). */
  persistedHistory: 10,
  /**
   * One page state, as JSON text in UTF-8 (H7): what a tab's page keeps now (`pageState`) and what each history entry keeps of the page it left. A write over it is refused and the page keeps the state it
   * had. A tab holds at most `history + 1` of them (816 KiB), a closed tab one, so the 25 closed tabs hold at most 400 KiB; what pages keep in practice (a sort, a search, a filter, an offset) is
   * about a hundred bytes.
   */
  pageStateBytes: 16 * 1024,
  /** Closed tabs kept (ch16 S30). */
  closed: 25,
  /** A scope label (ch16 S10). */
  scopeLabel: 24,
  /** Facets read from a description. */
  facets: 4,
  /** Titles listed for Back and Forward (ch16 S50). */
  historyList: 10,
});

export type GuardedAction = 'navigate' | 'close' | 'reload';

export type RefusedReason =
  /** The destination's plugin cannot serve it, or the plugin refused to complete it. */
  | 'unavailable'
  /** The route is not valid data. */
  | 'invalid'
  /** The tab is a singleton and cannot be duplicated. */
  | 'singleton'
  /** There is nothing to reopen. */
  | 'nothing-closed'
  /** The plugin dropped the closed tab when it was asked to restore it. */
  | 'dropped'
  /** No such tab. */
  | 'missing';

export type Done<T extends Record<string, unknown> = Record<string, unknown>> = { readonly status: 'done' } & T;
/** A legal request that changed nothing: the state is the same object, nobody is notified. */
export type Noop = { readonly status: 'noop' };
/** The request would discard unsaved changes: ask the user, then repeat it with `confirmed: true` (ch16 S27). */
export type Confirm = { readonly status: 'confirm'; readonly action: GuardedAction; readonly tabs: readonly TabId[] };
export type Refused = { readonly status: 'refused'; readonly reason: RefusedReason; readonly message: string };

export type OpenChange = 'created' | 'activated' | 'navigated';

export type OpenResult =
  | Done<{
    readonly id: TabId;
    readonly change: OpenChange;
    /** The tab is the one on screen now. False for a background open, so the caller can say "Opened {title} in a new tab". */
    readonly focused: boolean;
  }>
  | Noop
  | Confirm
  | Refused
  /** The destination wants a window of its own (ch16 S64) and the model has none: nothing changed. `existing` is the singleton that is already open. */
  | { readonly status: 'window'; readonly route: Route; readonly existing?: TabId | undefined };

export type CloseScope = 'others' | 'right' | 'left' | 'unpinned';

export type CloseResult = Done<{ readonly closed: readonly TabId[]; readonly active: TabId | null }> | Noop | Confirm | Refused;
export type TabResult = Done<{ readonly id: TabId }> | Noop | Confirm | Refused;

export type Preferences = {
  /** The setting "Open search results" (ch16 S64, L6). */
  readonly openResults: 'smart' | 'new-tab' | 'current-tab';
  /** Reuse a preview tab for search results (ch16 S24). */
  readonly reusePreview: boolean;
};

export type OpenOptions = {
  readonly how?: OpenHow | undefined;
  /** Where the destination came from; `search` opens a preview tab (ch16 S24) and follows the setting. */
  readonly source?: string | undefined;
  /** A new tab goes directly after this one (ch16 S28). Default: after the tab on screen. */
  readonly after?: TabId | undefined;
  /** The user was asked about unsaved changes and chose to discard them. */
  readonly confirmed?: boolean | undefined;
};

export type Guard = { readonly confirmed?: boolean | undefined };

export type NavigateOptions = Guard & {
  /** `push` (the default) adds an entry to the tab's history; `replace` swaps the current one, as a change of scope does (ch16 S60). */
  readonly history?: 'push' | 'replace' | undefined;
  readonly source?: string | undefined;
  /**
   * A place is one tab (ch16 S26: `{plugin}:{scope}:{page}`): `open` shows the tab that already shows a key instead of opening a second one, but a navigation moves THIS tab, so two tabs may come to show one place, as `new` and Duplicate let them. With `reuse`, a destination that another tab already
   * shows is that tab's: it is shown, and this tab stays where it is with its route and its history, as it does for a singleton page. A change of scope asks it (the connection of a tab chosen while an overview or a list of that connection is open in another tab: N4 of the review of HM3b).
   */
  readonly reuse?: boolean | undefined;
};

export type ReopenOptions = {
  /** A closed tab to bring back. Default: the newest that its plugin can still serve. */
  readonly id?: TabId | undefined;
};

/** Whether a closed tab can come back, and if not why (ch16 CR3). `message` is for a person; `reason` is for a program. */
export type ReopenCheck = { readonly ok: true } | { readonly ok: false; readonly reason: 'nothing-closed' | 'unavailable'; readonly message: string };

export type HistoryDirection = 'back' | 'forward';

/** The key and pointer state that picks a disposition (ch16 S64). Structural: a DOM event satisfies it. */
export type ModifierEvent = {
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly button?: number | undefined;
  readonly type?: string | undefined;
};

/** One entry of Back and Forward's list (ch16 S50), nearest first. */
export type HistoryItem = { readonly index: number; readonly route: Route; readonly title: string };

/** The answer for every surface that names a tab: its label, accessible name, tooltip and path (ch16 TI1). No surface builds its own. */
export type Identity = {
  readonly id: TabId;
  /** The plugin's own title. */
  readonly title: string;
  /** The shortest text that tells this tab from another that reads the same; empty when none is needed. */
  readonly qualifier: string;
  readonly parts: readonly string[];
  /** `{title} · {qualifier}`, or the title: the tab's label and the window's title. */
  readonly label: string;
  /** The accessible name, without state words. */
  readonly name: string;
  /** The tooltip's first line: `Plugin › Scope › Path`, with the qualifier when the path does not say it. */
  readonly tip: string;
  /** The status bar's crumbs, with the qualifier on the leaf when the path does not hold it. */
  readonly path: readonly Crumb[];
};

/** What the strip draws for a tab. The identity object is the same while the face and the other tabs' faces stay the same. */
export type StripItem = {
  readonly id: TabId;
  readonly identity: Identity;
  readonly icon: string;
  /** The scope's label, for the face's muted text. */
  readonly scope: string;
  readonly pinned: boolean;
  readonly preview: boolean;
  readonly unsaved: boolean;
  readonly attention: Attention;
  readonly singleton: boolean;
};

/** The status bar's path: the tab on screen, root first (ch16 S61). */
export type Breadcrumb = { readonly tab: TabId; readonly crumbs: readonly Crumb[] };

/** What a tab strip, a page host and a breadcrumb each subscribe to. All are functions of the snapshot; the memoised ones return the same object while their slice is the same. */
export type Selectors = {
  readonly ids: (state: TabsState) => readonly TabId[];
  readonly active: (state: TabsState) => TabId | null;
  readonly tab: (state: TabsState, id: TabId) => Tab | undefined;
  /** The page host's slice of one tab. */
  readonly location: (state: TabsState, id: TabId) => Location | undefined;
  readonly face: (state: TabsState, id: TabId) => Face | undefined;
  readonly flags: (state: TabsState, id: TabId) => Flags | undefined;
  readonly reveal: (state: TabsState, id: TabId) => Reveal | undefined;
  readonly identity: (state: TabsState, id: TabId) => Identity | undefined;
  readonly strip: (state: TabsState) => readonly StripItem[];
  readonly stripItem: (state: TabsState, id: TabId) => StripItem | undefined;
  readonly breadcrumb: (state: TabsState) => Breadcrumb | undefined;
  /** The pages to keep mounted, in strip order (see `KeepAlive`). */
  readonly mounted: (state: TabsState) => readonly TabId[];
  readonly closed: (state: TabsState) => readonly ClosedTab[];
};

/** What a saved tab holds: no page state (not the page on screen's, and none of its history's), no flags that mean "now" (unsaved, attention), no reveal request. */
export type PersistedTab = {
  readonly id: TabId;
  readonly route: Route;
  readonly key: string;
  readonly face: Face;
  readonly pinned: boolean;
  readonly preview: boolean;
  readonly history: PersistedHistory;
};

/** What the session saves for the strip: the version first, then the tabs in order and the one on screen (ch16 S32). */
export type PersistedTabs = {
  readonly version: typeof STATE_VERSION;
  readonly active: TabId | null;
  readonly tabs: readonly PersistedTab[];
};
