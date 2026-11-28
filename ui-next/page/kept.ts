// What the list page writes down for the host to give back (`PageMemory`) besides its sort (`sort.ts`): the search the person applied, the quick filter they chose, and where the table is scrolled. Each is one member
// of the plain record the host keeps for the tab (its `pageState`), written only by a `keep…` and read only by a `kept…`, and the host's record holds other members too (what else the host keeps, what an older
// version of the page wrote), so a write keeps the others as they are and a read trusts nothing: a value that is not what the member should hold is no search, no filter and no position, and is not an error.
// The member `scroll` is the one the tab model knows (ch16 S141): a navigation to a place the tab has been at takes the rest of what it kept, and leaves the offset (`shell/core/tabs/resolve.ts`, `seeded`).

/** The longest search that is kept: a longer text is not a search, and neither is written nor given back (the host keeps at most 16 KiB for a tab, and the search is one member of it). */
export const SEARCH_KEPT_MAX = 2048;

/** The farthest offset that is a position: a table is never that long. */
const SCROLL_KEPT_MAX = 10_000_000;

export type Scroll = { readonly top: number; readonly left: number };

/** One member of what the host held, whatever it held: `undefined` when it held no record, or the record has no member of that name. */
function memberOf(kept: unknown, name: string): unknown {
  return typeof kept === 'object' && kept !== null && !Array.isArray(kept) && name in kept ? (kept as Readonly<Record<string, unknown>>)[name] : undefined;
}

/** What the host held, with one member set, or taken out when `value` is `undefined`. A record that is left empty is `null`: a page that keeps nothing is a page that kept nothing. A value that is no record is started again. */
function withMember(kept: unknown, member: string, value: unknown): unknown {
  const held = typeof kept === 'object' && kept !== null && !Array.isArray(kept) ? (kept as Readonly<Record<string, unknown>>) : {};
  const others = Object.fromEntries(Object.entries(held).filter(([name]) => name !== member));
  const next = value === undefined ? others : { ...others, [member]: value };
  return Object.keys(next).length === 0 ? null : next;
}

/** The search the page was left with, read back from what the host held: the text it kept, or none. */
export function keptSearch(kept: unknown): string {
  const search = memberOf(kept, 'search');
  return typeof search === 'string' && search.length <= SEARCH_KEPT_MAX ? search : '';
}

/** What the page writes once the search `search` is applied: with the search set in what the host held, or taken out when there is none or it is too long to be one. */
export const keepSearch = (kept: unknown, search: string): unknown => withMember(kept, 'search', search === '' || search.length > SEARCH_KEPT_MAX ? undefined : search);

/** The quick filter the page was left with: the one it kept while this list still has a filter of that id (a plugin that came back with other filters is drawn with none chosen), else none. */
export function keptFilter(kept: unknown, filters: ReadonlyArray<{ readonly id: string }> | undefined): string | null {
  const filter = memberOf(kept, 'filter');
  return typeof filter === 'string' && filters?.some((candidate) => candidate.id === filter) === true ? filter : null;
}

/** What the page writes once the quick filter is `filter` (`null`: All): with the filter set in what the host held, or taken out. */
export const keepFilter = (kept: unknown, filter: string | null): unknown => withMember(kept, 'filter', filter ?? undefined);

/** Only restore a subtab that the owner's current definition still declares. */
export function keptDetailTab(kept: unknown, tabs: ReadonlyArray<{ readonly id: string }>): string | undefined {
  const value = memberOf(kept, 'detailTab');
  return typeof value === 'string' && tabs.some(tab => tab.id === value) ? value : undefined;
}

export const keepDetailTab = (kept: unknown, tab: string): unknown => withMember(kept, 'detailTab', tab);

/** A whole, positive offset, or 0 for what is not one: a negative number, a text, NaN and what no table is long enough for. */
const offset = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= SCROLL_KEPT_MAX ? Math.round(value) : 0);

/** Where the table was left scrolled, read back: whole, non-negative numbers, and none at all (the table's start) when there is nothing to put back. */
export function keptScroll(kept: unknown): Scroll | undefined {
  const scroll = memberOf(kept, 'scroll');
  const top = offset(memberOf(scroll, 'top'));
  const left = offset(memberOf(scroll, 'left'));
  return top === 0 && left === 0 ? undefined : { top, left };
}

/** What the page writes once the table is at `scroll`: with the position set in what the host held, or taken out when the table is at its start. */
export function keepScroll(kept: unknown, scroll: Scroll): unknown {
  const top = offset(scroll.top);
  const left = offset(scroll.left);
  return withMember(kept, 'scroll', top === 0 && left === 0 ? undefined : { top, left });
}
