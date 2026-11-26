import { CollectionFooter } from '@omniviewdev/kit';

// The footer sits at the bottom of a pane, so each example is the lane alone, at the width of the page it would close.

/** Everything shown, nothing selected: the count and nothing else. A healthy collection has nothing more to say (design 13 FT1). */
export const Default = () => <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" />;

/** A search or a filter hides some: "12 of 89 items". Zero is a count: "0 of 24 items" is what a search that matched nothing reads. */
export const Filtered = () => <CollectionFooter shown={12} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" />;

/** The set is still arriving (decision A10): how many are in hand, and no total that could be wrong. */
export const Loaded = () => <CollectionFooter shown={89} total={{ kind: 'unknown' }} noun="item" plural="items" />;

/** While the set loads, a search shows how many of the loaded items match. */
export const LoadedAndFiltered = () => <CollectionFooter shown={50} total={{ kind: 'unknown', loaded: 89 }} noun="item" plural="items" />;

/** A source that can only estimate its size says so. */
export const Estimated = () => <CollectionFooter shown={120} total={{ kind: 'estimate', value: 120 }} noun="item" plural="items" />;

/** The selection follows the count in the same cluster, 12 px apart. */
export const Selected = () => <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" selected={3} />;

/** The width dropped two columns the person did not choose: one muted note, and its tip names them. */
export const HiddenColumns = () => (
  <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" hiddenColumns={{ names: ['Node', 'Address'] }} />
);

/** The data is being read again: one muted item at the end of the lane. It is not announced here: the page's operation slot says it once. */
export const Refreshing = () => <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" status={{ text: 'Refreshing…', busy: true }} />;

/** The read is done: the same item says so, for a while, and then the caller takes it away. */
export const Updated = () => <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" status={{ text: 'Updated just now' }} />;

/** The two ambient items share the trailing cluster, 12 px apart: the note about the width first, the state of the data last. */
export const StatusWithHiddenColumns = () => (
  <CollectionFooter
    shown={89}
    total={{ kind: 'exact', value: 89 }}
    noun="item"
    plural="items"
    hiddenColumns={{ names: ['Node', 'Address'] }}
    status={{ text: 'Refreshing…', busy: true }}
  />
);
