import type { DataColor, StatusRole } from '@omniviewdev/kit';
import { useMemo, useSyncExternalStore } from 'react';
import type { ConnectionV1, ConnectionsViewV1, SidebarContextV1, SidebarNodeV1 } from '../../contract/v1';

// The navigator of the connections fixture's landing variant (KL5; `entry-landing.tsx`): what the plugin's sidebar hook answers while one of the plugin's two pages that are read in no connection (the landing and the page of all its connections) is on screen,
// from the connections the host hands the hook (`context.connections`, the window's own store: nothing here holds a list). An entry that opens the landing, two that open it with a parameter (the filters, each with its count), and a group of the plugin's
// connections (KL7: it says it starts open), each a leaf that opens that connection with a colour for its glyph and, on the ones that need a look, a badge. The hook is told the route's parameters (KL7), so the filters carry the landing's other parameter, `sort`, to the place
// they open: choosing a filter keeps the order the person chose, and the entry whose parameters are the page's is the one selected. The plugin's pages of a connection have the skeleton they always had: the hook answers nothing for them.

/** The landing's filters: the parameter the landing reads (`filter`) and what the entry that opens it says. */
export const FILTERS = { connected: 'Connected', attention: 'Needs attention' } as const;
export type Filter = keyof typeof FILTERS;

export const isFilter = (value: string | undefined): value is Filter => value !== undefined && Object.hasOwn(FILTERS, value);

/** The orders the landing lists its cards in: the second parameter it reads (`sort`), which the page changes itself (`context.setParams`) and the navigator carries to the entries it opens. */
export const SORTS = { name: 'Name', state: 'State' } as const;
export type Sort = keyof typeof SORTS;

export const isSort = (value: string | undefined): value is Sort => value !== undefined && Object.hasOwn(SORTS, value);

/** The route parameters of a place of the landing: what is the default is left out, so the bare landing has none. */
export const paramsOf = (filter: Filter | undefined, sort: Sort): Readonly<Record<string, string>> => ({ ...(filter === undefined ? {} : { filter }), ...(sort === 'name' ? {} : { sort }) });

/** A connection that needs a look is one the host says needs attention or has failed: the words it says them in are the host's. */
const needsLook = (connection: ConnectionV1): boolean => connection.role === 'attention' || connection.role === 'error';

/** Whether a connection is in a filter. */
export const inFilter = (connection: ConnectionV1, filter: Filter): boolean => (filter === 'connected' ? connection.state === 'connected' : needsLook(connection));

/** The colour of a connection's glyph, by the role the host gives its state: a colour never says it alone, the badge and the name beside it do. */
const TONES: Readonly<Record<StatusRole, DataColor>> = { healthy: 'green', running: 'green', progress: 'blue', attention: 'amber', error: 'red', stopped: 'gray', info: 'blue' };

const FILTER_ICONS = { connected: 'plug', attention: 'bell' } as const;

function leafOf(connection: ConnectionV1): SidebarNodeV1 {
  return {
    id: `connection-${connection.key}`,
    label: connection.name,
    icon: 'server',
    tone: TONES[connection.role],
    connection: connection.key,
    ...(needsLook(connection) ? { status: { role: connection.role, label: connection.word } } : {}),
  };
}

/** The navigator: counts are held (`null`) until the host has read the connections, so that a number that arrives moves no label. Every entry that opens the landing, All included, opens it in the order the page is in now (`sort`), so choosing one keeps the order the person chose. */
export function navigatorOf(view: ConnectionsViewV1, sort: Sort = 'name'): readonly SidebarNodeV1[] {
  const count = (filter: Filter): number | null => (view.loaded ? view.connections.filter((connection) => inFilter(connection, filter)).length : null);
  return [
    { id: 'filter-all', label: 'All', icon: 'layers', count: view.loaded ? view.connections.length : null, page: 'landing', params: paramsOf(undefined, sort) },
    ...(Object.keys(FILTERS) as Filter[]).map((filter): SidebarNodeV1 => ({ id: `filter-${filter}`, label: FILTERS[filter], icon: FILTER_ICONS[filter], count: count(filter), page: 'landing', params: paramsOf(filter, sort) })),
    { id: 'connections', label: 'Connections', icon: 'server', expanded: true, children: view.connections.map(leafOf) },
  ];
}

/** The plugin's sidebar hook: the navigator on a page read in no connection, and nothing on any other, where the skeleton stands. */
export function useNavigator({ route, connections }: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const navigated = route.page === 'landing' || route.page === 'all';
  const sort = isSort(route.params.sort) ? route.params.sort : 'name';
  return useMemo(() => (navigated ? navigatorOf(view, sort) : undefined), [navigated, view, sort]);
}
