import { identities, type IdentityEntry } from './identity';
import { sameItems } from './json';
import type { Breadcrumb, Identity, Selectors, StripItem, Tab, TabId, TabsState } from './types';

// What a tab strip, a page host and a status-bar breadcrumb each subscribe to. Every selector is a function of the snapshot. One that only reads a part of the state returns
// that part, which is the same object while it did not change (the state is updated by structural sharing); one that derives a list or an object keeps its last answer and
// hands it back while its content is the same. So updating one tab's title changes the answer of what reads that tab and nothing that reads another (docs/ui-next/optimisations.md MNR-T16's
// rule for rows, applied to tabs: a unit renders for its own data).

type Derived = {
  readonly tabs: TabsState['tabs'];
  readonly order: TabsState['order'];
  readonly entries: ReadonlyMap<TabId, IdentityEntry>;
  readonly items: ReadonlyMap<TabId, StripItem>;
  readonly strip: readonly StripItem[];
};

const stripItemOf = (id: TabId, identity: Identity, tab: Tab): StripItem =>
  Object.freeze({
    id,
    identity,
    icon: tab.face.icon,
    scope: tab.face.scope?.label ?? '',
    pinned: tab.flags.pinned,
    preview: tab.flags.preview,
    unsaved: tab.flags.unsaved,
    attention: tab.flags.attention,
    singleton: tab.face.singleton,
  });

const sameStripItem = (item: StripItem, identity: Identity, tab: Tab): boolean =>
  item.identity === identity && item.icon === tab.face.icon && item.scope === (tab.face.scope?.label ?? '') && item.pinned === tab.flags.pinned && item.preview === tab.flags.preview
  && item.unsaved === tab.flags.unsaved && item.attention === tab.flags.attention && item.singleton === tab.face.singleton;

/** The selectors of one store. Their caches belong to it: two stores share nothing. */
export function createSelectors(): Selectors {
  let derived: Derived | undefined;
  let breadcrumb: Breadcrumb | undefined;
  let mounted: { readonly source: TabsState['mounted']; readonly order: TabsState['order']; readonly list: readonly TabId[] } | undefined;

  const derive = (state: TabsState): Derived => {
    if (derived?.tabs === state.tabs && derived.order === state.order) {
      return derived;
    }

    const entries = identities(state, derived?.entries);
    const items = new Map<TabId, StripItem>();
    const list: StripItem[] = [];
    for (const id of state.order) {
      const tab = state.tabs[id];
      const entry = entries.get(id);
      if (tab === undefined || entry === undefined) {
        continue;
      }

      const before = derived?.items.get(id);
      const item = before !== undefined && sameStripItem(before, entry.identity, tab) ? before : stripItemOf(id, entry.identity, tab);
      items.set(id, item);
      list.push(item);
    }

    derived = { tabs: state.tabs, order: state.order, entries, items, strip: sameItems(derived?.strip, Object.freeze(list)) };
    return derived;
  };

  return {
    ids: (state) => state.order,
    active: (state) => state.active,
    tab: (state, id) => state.tabs[id],
    location: (state, id) => state.tabs[id]?.location,
    face: (state, id) => state.tabs[id]?.face,
    flags: (state, id) => state.tabs[id]?.flags,
    reveal: (state, id) => state.tabs[id]?.reveal,
    identity: (state, id) => derive(state).entries.get(id)?.identity,
    strip: (state) => derive(state).strip,
    stripItem: (state, id) => derive(state).items.get(id),
    breadcrumb: (state) => {
      const identity = state.active === null ? undefined : derive(state).entries.get(state.active)?.identity;
      if (!identity || state.active === null) {
        breadcrumb = undefined;
      } else if (breadcrumb?.tab !== state.active || breadcrumb.crumbs !== identity.path) {
        breadcrumb = Object.freeze({ tab: state.active, crumbs: identity.path });
      }

      return breadcrumb;
    },
    mounted: (state) => {
      if (mounted?.source === state.mounted && mounted.order === state.order) {
        return mounted.list;
      }

      const wanted = new Set(state.mounted);
      const list = sameItems(mounted?.list, Object.freeze(state.order.filter((id) => wanted.has(id))));
      mounted = { source: state.mounted, order: state.order, list };
      return list;
    },
    closed: (state) => state.closed,
  };
}
