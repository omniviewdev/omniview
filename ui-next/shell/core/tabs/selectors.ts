import { identities } from './identity';
import { sameItems } from './json';
import type { Breadcrumb, Identity, Selectors, StripItem, TabId, TabsState } from './types';

// What a tab strip, a page host and a status-bar breadcrumb each subscribe to. Every selector is a function of the snapshot. One that only reads a part of the state returns
// that part, which is the same object while it did not change (the state is updated by structural sharing); one that derives a list or an object keeps its last answer and
// hands it back while its content is the same. So updating one tab's title changes the answer of what reads that tab and nothing that reads another (docs/ui-next/optimisations.md MNR-T16's
// rule for rows, applied to tabs: a unit renders for its own data).

type Derived = {
  readonly tabs: TabsState['tabs'];
  readonly order: TabsState['order'];
  readonly identities: ReadonlyMap<TabId, Identity>;
  readonly items: ReadonlyMap<TabId, StripItem>;
  readonly strip: readonly StripItem[];
};

/** The selectors of one store. Their caches belong to it: two stores share nothing. */
export function createSelectors(): Selectors {
  let derived: Derived | undefined;
  let breadcrumb: Breadcrumb | undefined;
  let mounted: { readonly source: TabsState['mounted']; readonly order: TabsState['order']; readonly list: readonly TabId[] } | undefined;

  const derive = (state: TabsState): Derived => {
    if (derived?.tabs === state.tabs && derived.order === state.order) {
      return derived;
    }

    const made = identities(state, derived?.identities);
    const items = new Map<TabId, StripItem>();
    for (const id of state.order) {
      const tab = state.tabs[id];
      const identity = made.get(id);
      if (!tab || !identity) {
        continue;
      }

      const next: StripItem = {
        id,
        identity,
        icon: tab.face.icon,
        scope: tab.face.scope?.label ?? '',
        pinned: tab.flags.pinned,
        preview: tab.flags.preview,
        unsaved: tab.flags.unsaved,
        attention: tab.flags.attention,
        singleton: tab.face.singleton,
      };
      const before = derived?.items.get(id);
      const same = before?.identity === next.identity && before.icon === next.icon && before.scope === next.scope && before.pinned === next.pinned && before.preview === next.preview
        && before.unsaved === next.unsaved && before.attention === next.attention && before.singleton === next.singleton;
      items.set(id, before && same ? before : Object.freeze(next));
    }

    const strip = sameItems(derived?.strip, state.order.flatMap((id) => items.get(id) ?? []));
    derived = { tabs: state.tabs, order: state.order, identities: made, items, strip };
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
    identity: (state, id) => derive(state).identities.get(id),
    strip: (state) => derive(state).strip,
    stripItem: (state, id) => derive(state).items.get(id),
    breadcrumb: (state) => {
      const identity = state.active === null ? undefined : derive(state).identities.get(state.active);
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
