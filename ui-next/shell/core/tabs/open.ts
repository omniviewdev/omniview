import { lenientJson } from './json';
import { normaliseRoute, routeSays, sameRoute } from './route';
import { pushed, replaced, resolveDestination, type Context, type Moved, type Resolved } from './resolve';
import { activeTab, applyKeepAlive, changeTab, flagsOf, freshId, makeTab, patch, pinnedCount, refuse, show, unchanged, withTab, type Step } from './state';
import type { Destination, Json, NavigateOptions, OpenChange, OpenHow, OpenOptions, OpenResult, Reveal, RouteInput, Scope, Tab, TabId, TabResult, TabsState } from './types';

// The open model (ch16 S26, S28, S63 to S65): where a destination lands. Smart open goes where the page already is, else stays in the plugin it is in, else opens a tab.

/** What a request that names more than a page asks of the page that shows it (ch16 K1). */
type Ask = { readonly payload: Json | undefined; readonly source: string; readonly how: OpenHow };

type Plan = {
  readonly ctx: Context;
  readonly resolved: Resolved;
  readonly how: OpenHow;
  readonly ask: Ask | undefined;
  readonly confirmed: boolean;
  readonly after: TabId | undefined;
};

const sameScope = (a: Scope | undefined, b: Scope | undefined): boolean => (a?.id ?? null) === (b?.id ?? null);

/** The tab that shows a key: the one on screen, else the first in the strip. */
export function findByKey(state: TabsState, key: string): Tab | undefined {
  const active = activeTab(state);
  if (active?.location.key === key) {
    return active;
  }

  for (const id of state.order) {
    const tab = state.tabs[id];
    if (tab?.location.key === key) {
      return tab;
    }
  }

  return undefined;
}

/** Where a new tab goes: directly after `after`, else after the tab on screen, never into the pinned zone (ch16 S28, S38). */
export function insertIndex(state: TabsState, after: TabId | undefined): number {
  const anchor = after !== undefined && state.tabs[after] ? state.order.indexOf(after) : state.active === null ? state.order.length - 1 : state.order.indexOf(state.active);
  return Math.max(anchor + 1, pinnedCount(state));
}

/** A request asks something of the page when it names more than the page, or carries a payload; a plain open of a page asks nothing. */
const asked = (destination: Destination, resolved: Resolved, how: OpenHow, source: string): Ask | undefined =>
  destination.reveal !== undefined || Object.keys(resolved.route.params).length > 0 ? { payload: lenientJson(destination.reveal), source, how } : undefined;

/** The state with a request left on a tab for its page to answer. */
function request(state: TabsState, id: TabId, ask: Ask, resolved: Resolved, kind: { readonly fresh: boolean; readonly navigated: boolean }): TabsState {
  const tab = state.tabs[id];
  if (!tab) {
    return state;
  }

  const seq = state.serial + 1;
  const reveal: Reveal = Object.freeze({ seq, route: resolved.route, ...(ask.payload === undefined ? {} : { payload: ask.payload }), source: ask.source, how: ask.how, ...kind });
  return patch(withTab(state, changeTab(tab, { reveal })), { serial: seq });
}

const done = (state: TabsState, id: TabId, change: OpenChange, focused: boolean): Step<OpenResult> => ({ state, result: { status: 'done', id, change, focused } });

/**
 * The tab moved to the route of `plan`, and no preview. A push is a new entry in its history: the entry it leaves keeps what its page kept, and the page starts clean, but for a place the tab has been
 * at, which opens as it was left (`pushed`). A replace puts the route in the current entry (a change of scope): the page is another one, and starts clean (H7).
 */
function moveTab(state: TabsState, plan: Plan, tab: Tab, mode: 'push' | 'replace'): TabsState {
  const { route, face, key } = plan.resolved;
  const arrived: Moved = mode === 'push' ? pushed(tab.history, route, tab.pageState) : { history: replaced(tab.history, route), pageState: null };
  const moved = changeTab(tab, {
    location: Object.freeze({ route, key, generation: tab.location.generation }),
    face,
    history: arrived.history,
    pageState: arrived.pageState,
    flags: flagsOf({ ...tab.flags, preview: false, unsaved: false }),
    reveal: undefined,
  });
  const next = applyKeepAlive(withTab(state, moved));
  return plan.ask ? request(next, tab.id, plan.ask, plan.resolved, { fresh: false, navigated: true }) : next;
}

/** Navigates a tab in place, after asking about unsaved changes (ch16 S27). A route the tab already shows pushes nothing. */
function navigateTab(state: TabsState, plan: Plan, tab: Tab, mode: 'push' | 'replace'): Step<OpenResult> {
  if (sameRoute(tab.location.route, plan.resolved.route)) {
    const next = plan.ask ? request(state, tab.id, plan.ask, plan.resolved, { fresh: false, navigated: false }) : state;
    return done(next, tab.id, 'activated', next.active === tab.id);
  }

  if (tab.flags.unsaved && !plan.confirmed) {
    return { state, result: { status: 'confirm', action: 'navigate', tabs: [tab.id] } };
  }

  const next = moveTab(state, plan, tab, mode);
  return done(next, tab.id, 'navigated', next.active === tab.id);
}

/** A tab that already shows the key: shown, and asked to reveal what the destination names. */
function activateExisting(state: TabsState, plan: Plan, tab: Tab): Step<OpenResult> {
  const shown = show(state, tab.id);
  const next = plan.ask ? request(shown, tab.id, plan.ask, plan.resolved, { fresh: false, navigated: false }) : shown;
  return done(next, tab.id, 'activated', true);
}

/**
 * A singleton that is open (ch16 S26) is where every disposition lands, and the request is applied to it (K1): it is shown (Background leaves the focus where it is), pointed
 * at the route the request names when that says more than the tab shows, and its page asked. A tab with unsaved changes is shown first and then asks; Background leaves it alone.
 */
function openExisting(state: TabsState, plan: Plan, tab: Tab): Step<OpenResult> {
  if (plan.how === 'window') {
    return { state, result: { status: 'window', route: plan.resolved.route, existing: tab.id } };
  }

  const background = plan.how === 'background';
  const moves = routeSays(plan.resolved.route, tab.location.route);
  if (moves && tab.flags.unsaved && !plan.confirmed) {
    return background ? done(state, tab.id, 'activated', false) : { state: show(state, tab.id), result: { status: 'confirm', action: 'navigate', tabs: [tab.id] } };
  }

  const shown = background ? state : show(state, tab.id);
  if (moves) {
    return done(moveTab(shown, plan, tab, 'push'), tab.id, 'navigated', !background);
  }

  const next = plan.ask ? request(shown, tab.id, plan.ask, plan.resolved, { fresh: false, navigated: false }) : shown;
  return done(next, tab.id, 'activated', !background);
}

/** A new tab. A preview replaces the one preview there is, in its place, and leaves no closed tab behind (ch16 S24). */
function createTab(state: TabsState, plan: Plan, kind: { readonly background?: boolean; readonly preview?: boolean }): Step<OpenResult> {
  const id = freshId(state, plan.ctx.newId);
  const { route, face, key } = plan.resolved;
  const old = kind.preview === true ? state.order.find((other) => state.tabs[other]?.flags.preview) : undefined;
  const index = old === undefined ? insertIndex(state, plan.after) : state.order.indexOf(old);
  const tab = makeTab({ id, route, key, face, flags: { preview: kind.preview === true } });
  const order = old === undefined ? [...state.order.slice(0, index), id, ...state.order.slice(index)] : [...state.order.slice(0, index), id, ...state.order.slice(index + 1)];
  const tabs: Record<TabId, Tab> = { ...state.tabs, [id]: tab };
  if (old !== undefined) {
    Reflect.deleteProperty(tabs, old);
  }

  let next = patch(state, { tabs: Object.freeze(tabs), order: Object.freeze(order), mounted: Object.freeze(state.mounted.filter((other) => other !== old)), active: state.active === old ? null : state.active });
  const background = kind.background === true && next.active !== null;
  if (!background) {
    next = show(next, id);
  }

  return done(plan.ask ? request(next, id, plan.ask, plan.resolved, { fresh: true, navigated: false }) : next, id, 'created', !background);
}

/**
 * Opens a destination (ch16 S64): `smart` (Enter) goes where the page already is (a tab that shows the key, any window for a singleton), else navigates the tab on screen when
 * it is in the same plugin and scope, else opens a tab, a preview one when it came from search results. `here` replaces the page of the tab on screen, `new` opens a tab
 * that is not deduplicated, `background` opens it after the tab on screen and leaves the focus, and `window` is handed back: the model has no windows.
 */
export function open(state: TabsState, ctx: Context, destination: Destination, options: OpenOptions = {}): Step<OpenResult> {
  const source = options.source ?? 'api';
  const current = activeTab(state);
  const resolution = resolveDestination(ctx, destination.route, source, current?.location.route);
  if (!resolution.ok) {
    return refuse(state, resolution.reason, resolution.message);
  }

  const { resolved } = resolution;
  let how = options.how ?? 'smart';
  if (how === 'smart' && source === 'search') {
    const { openResults } = ctx.preferences();
    how = openResults === 'new-tab' ? 'new' : openResults === 'current-tab' ? 'here' : how;
  }

  const plan: Plan = { ctx, resolved, how, ask: asked(destination, resolved, how, source), confirmed: options.confirmed === true, after: options.after };
  if (resolved.face.singleton) {
    const hit = findByKey(state, resolved.key);
    if (hit) {
      return openExisting(state, plan, hit);
    }
  }

  if (how === 'window') {
    return { state, result: { status: 'window', route: resolved.route } };
  }

  if (how === 'here') {
    return current ? navigateTab(state, plan, current, 'push') : createTab(state, plan, {});
  }

  if (how === 'new' || how === 'background') {
    return createTab(state, plan, { background: how === 'background' });
  }

  if (resolved.face.identity !== 'none') {
    const hit = findByKey(state, resolved.key);
    if (hit) {
      return activateExisting(state, plan, hit);
    }

    if (current?.location.route.plugin === resolved.route.plugin && sameScope(current.face.scope, resolved.face.scope)) {
      return navigateTab(state, plan, current, 'push');
    }
  }

  return createTab(state, plan, { preview: source === 'search' && ctx.preferences().reusePreview });
}

/**
 * Navigates a tab: pushes a new entry in its history, or replaces the current one (a change of scope), after asking about unsaved changes. A place that another tab already shows is shown, and this tab stays where it is, when the page is a singleton (ch16 S26) and when the request
 * says `reuse` (`NavigateOptions`): a change of scope to a place that is open is not a second copy of it.
 */
export function navigate(state: TabsState, ctx: Context, id: TabId, destination: Destination, options: NavigateOptions = {}): Step<TabResult> {
  const tab = state.tabs[id];
  if (!tab) {
    return refuse(state, 'missing', `There is no tab ${id}.`);
  }

  const resolution = resolveDestination(ctx, destination.route, options.source ?? 'api', tab.location.route);
  if (!resolution.ok) {
    return refuse(state, resolution.reason, resolution.message);
  }

  if (sameRoute(tab.location.route, resolution.resolved.route)) {
    return unchanged(state);
  }

  // A singleton page is one tab in the whole app (ch16 S26): going to it shows the tab that holds it, and this tab stays where it is. A request that says `reuse` asks the same of any place another tab already shows (N4 of the review of HM3b); with no other tab on it, the tab
  // moves, as it was told to.
  const elsewhere = resolution.resolved.face.singleton || options.reuse === true ? findByKey(state, resolution.resolved.key) : undefined;
  if (elsewhere && elsewhere.id !== id) {
    return { state: show(state, elsewhere.id), result: { status: 'done', id: elsewhere.id } };
  }

  if (tab.flags.unsaved && options.confirmed !== true) {
    return { state, result: { status: 'confirm', action: 'navigate', tabs: [id] } };
  }

  const plan: Plan = { ctx, resolved: resolution.resolved, how: 'here', ask: undefined, confirmed: true, after: undefined };
  return { state: moveTab(state, plan, tab, options.history ?? 'push'), result: { status: 'done', id } };
}

/**
 * A change inside the page that is part of its route (a sub-tab, a filter): the current entry of the tab's history is replaced and nothing is pushed. The page state, the
 * unsaved flag and the preview are kept: the page is the same page.
 */
export function replace(state: TabsState, ctx: Context, id: TabId, input: RouteInput): Step<TabResult> {
  const tab = state.tabs[id];
  if (!tab) {
    return refuse(state, 'missing', `There is no tab ${id}.`);
  }

  const asked = normaliseRoute(input);
  const route = asked ? ctx.plugins.complete(asked, tab.location.route, 'page') : undefined;
  if (!route) {
    return refuse(state, 'invalid', 'The route is not valid, or its plugin refused it.');
  }

  if (sameRoute(tab.location.route, route)) {
    return unchanged(state);
  }

  const { face, key } = ctx.plugins.look(route);
  const elsewhere = face.singleton ? findByKey(state, key) : undefined;
  if (elsewhere && elsewhere.id !== id) {
    return refuse(state, 'singleton', `Only one ${face.title} tab can exist`);
  }

  const moved = changeTab(tab, { location: Object.freeze({ route, key, generation: tab.location.generation }), face, history: replaced(tab.history, route) });
  return { state: withTab(state, moved), result: { status: 'done', id } };
}

/**
 * The window opens with something to show when it can: at its start, with no tab, the home page opens (ch16 S30). It does nothing when a tab is open, when no home page is offered, and when
 * the plugin that offers it cannot serve it now (a later change of the plugins tries again). It does nothing once the window has started, that is once a tab has been on screen: a strip
 * the user emptied stays empty (decision A17, which amends ch16 S8 and S30: "closing the last tab opens Home"), because a page that comes back by itself is a trap, and the window
 * has its empty state and a way out.
 */
export function ensureHome(state: TabsState, ctx: Context): TabsState {
  if (state.order.length > 0 || state.started) {
    return state;
  }

  const home = ctx.plugins.home();
  const resolution = home ? resolveDestination(ctx, home, 'home', undefined) : undefined;
  if (!resolution?.ok) {
    return state;
  }

  return createTab(state, { ctx, resolved: resolution.resolved, how: 'new', ask: undefined, confirmed: true, after: undefined }, {}).state;
}
