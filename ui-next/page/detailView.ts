import type { PageHeaderCommands, PageHeaderFact, PageHeaderState, PageOperation, TabsItem } from '@omniviewdev/kit';
import type { DetailPageDefinition, DetailSection, DetailSource, DetailTabContent, DetailView } from './detailDefinition';
import { nameOf, type RouteParams } from './detailIdentity';

// The detail page as a function of its definition, its route and its source: the decisions, in plain data, with no framework. The page draws them (`DetailPage.tsx`); the tests read them.

/** The words of the states the page itself words (the plugin's own detail goes under them). */
export type DetailBody =
  | { readonly kind: 'loading'; readonly label: string }
  | { readonly kind: 'not-found'; readonly title: string; readonly hint: string }
  | { readonly kind: 'denied'; readonly title: string; readonly message: string }
  | { readonly kind: 'failed'; readonly title: string; readonly message: string | undefined; readonly retry: (() => void) | undefined }
  | { readonly kind: 'tab'; readonly tab: string; readonly content: DetailTabContent | undefined };

/** A read that failed after the object was shown: the page keeps what it has and says so. `retry` is the plugin's, given only when asking again can help. */
export type DetailFailure = { readonly title: string; readonly message: string | undefined; readonly retry: (() => void) | undefined };

export type DetailModel = {
  /** The object's name, or an empty string when the route has none. */
  readonly name: string;
  /** The page's one h1: the name, or the kind when there is no name. */
  readonly heading: string;
  /** The identity line's state chip: the object's own once it is read, a progress word while it is on its way. */
  readonly state: PageHeaderState | undefined;
  /** The identity line's facts: never none while there is no state, so the line is there from the first frame. */
  readonly facts: readonly PageHeaderFact[];
  /** The plugin's commands: only for an object that is on screen. */
  readonly commands: Omit<PageHeaderCommands, 'utility'> | undefined;
  /** The plugin's own operation, when it has one. Absent: the slot shows the page's own acknowledgements (the Refresh feedback, a failed read). */
  readonly operation: PageOperation | undefined;
  /** A read that failed after the object was shown: what the page keeps on screen and says in the header's slot. Absent otherwise: a failure that left nothing to show is the body. */
  readonly failure: DetailFailure | undefined;
  /** Whether the object is on screen: its state is `ready`, or a failure followed it. */
  readonly shown: boolean;
  readonly tabs: readonly TabsItem[];
  /** The tab on screen: the one asked for when the definition has it, else the first. */
  readonly selected: string;
  readonly body: DetailBody;
};

/** What the person asked of the page: the tab they chose. */
export type DetailQuery = { readonly tab: string | undefined };

/** The progress word of the identity line while the object is on its way. */
const LOADING_STATE: PageHeaderState = { role: 'progress', label: 'Loading' };

/** A view is on screen while the object is read, and after a failure that came once it was: a failure does not take away what was shown. `not-found` and `denied` do. */
function shownView(source: DetailSource): DetailView | undefined {
  const { state, view } = source;
  return view !== undefined && (state.kind === 'ready' || state.kind === 'failed') ? view : undefined;
}

/** The article before a name: "orders-api was not found", or the kind alone when the route names nothing. */
const subject = (name: string, kind: string): string => (name === '' ? kind : name);

function bodyOf(definition: DetailPageDefinition, name: string, source: DetailSource, view: DetailView | undefined, tab: string): DetailBody {
  if (view !== undefined) {
    return { kind: 'tab', tab, content: view.tabs[tab] };
  }

  const { state } = source;
  const who = subject(name, definition.kind);
  switch (state.kind) {
    case 'not-found':
      return {
        kind: 'not-found',
        title: `${who} was not found`,
        hint: state.message ?? `${definition.kind}${name === '' ? '' : ` ${name}`} doesn't exist here. It may have been deleted.`,
      };
    case 'denied':
      return { kind: 'denied', title: `Access to ${who} is denied`, message: state.message ?? 'You don\'t have permission to read it.' };
    case 'failed':
      return { kind: 'failed', title: `Couldn't load ${who}`, message: state.message, retry: state.retry };
    case 'loading':
    case 'ready':
      // A `ready` source that has no view yet is still on its way.
      return { kind: 'loading', label: who };
  }
}

/** The page, decided. */
export function deriveDetailModel(definition: DetailPageDefinition, params: RouteParams, source: DetailSource, query: DetailQuery): DetailModel {
  const name = nameOf(definition, params);
  const view = shownView(source);
  const selected = definition.tabs.some((tab) => tab.id === query.tab) ? (query.tab ?? '') : (definition.tabs[0]?.id ?? '');
  const facts = view?.facts !== undefined && view.facts.length > 0 ? view.facts : view?.state === undefined ? [{ text: definition.kind }] : [];
  return {
    name,
    heading: subject(name, definition.kind),
    state: view === undefined ? (source.state.kind === 'loading' || source.state.kind === 'ready' ? LOADING_STATE : undefined) : view.state,
    facts,
    commands: view?.commands,
    operation: view?.operation,
    failure: view !== undefined && source.state.kind === 'failed' ? { title: `Couldn't refresh ${subject(name, definition.kind)}`, message: source.state.message, retry: source.state.retry } : undefined,
    shown: view !== undefined,
    tabs: definition.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      icon: tab.icon,
      count: view?.counts?.[tab.id],
    })),
    selected,
    body: bodyOf(definition, name, source, view, selected),
  };
}

/** A section has something to say. One that has none is not drawn (design 13 OVW1): never an empty heading, never a placeholder. */
export function hasContent(section: DetailSection): boolean {
  switch (section.kind) {
    case 'kv':
    case 'table':
    case 'list':
      return section.rows.length > 0;
    case 'tags':
      return section.items.length > 0;
  }

  // A kind this version does not draw (a plugin of a later contract): nothing to show, not a crash.
  return false;
}

/** The default priority of a section that states none: after every section that does, and in the order given among themselves. */
export const DEFAULT_PRIORITY = 50;

export type OverviewColumns = {
  readonly main: readonly DetailSection[];
  readonly aside: readonly DetailSection[];
};

/**
 * The Overview's sections in their two columns: the ones with something to say, each in the column it asks for (a table is never in the aside), lowest priority first, and in the
 * order they were given among equals.
 */
export function overviewColumns(sections: readonly DetailSection[]): OverviewColumns {
  const drawn = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => hasContent(section))
    .sort((a, b) => (a.section.priority ?? DEFAULT_PRIORITY) - (b.section.priority ?? DEFAULT_PRIORITY) || a.index - b.index)
    .map(({ section }) => section);
  const inAside = (section: DetailSection): boolean => section.kind !== 'table' && section.placement === 'aside';
  return { main: drawn.filter((section) => !inAside(section)), aside: drawn.filter(inAside) };
}
