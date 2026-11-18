import { TagList, type TagItem } from '@omniviewdev/kit';
import styles from './TagList.examples.module.css';

const few: readonly TagItem[] = [
  { key: 'app', value: 'orders-api' },
  { key: 'tier', value: 'backend' },
  { key: 'example.io/managed-by', value: 'helm' },
];

const twelve: readonly TagItem[] = [
  { key: 'app', value: 'orders-api' },
  { key: 'tier', value: 'backend' },
  { key: 'owner', value: 'north-yard' },
  { key: 'release', value: 'stable' },
  { key: 'region', value: 'north-1' },
  { key: 'example.io/managed-by', value: 'helm' },
  { key: 'example.io/part-of', value: 'checkout' },
  { key: 'example.io/version', value: '1.8.2' },
  { key: 'cost-centre', value: '4410' },
  { key: 'team', value: 'platform' },
  { key: 'tracing', value: 'enabled' },
  { key: 'canary', value: 'false' },
];

/** A few tags: each is a key and its value in one chip, the chips wrapping in rows, 8 px apart. */
export const FewTags = () => <TagList label="Labels" items={few} />;

/** More than six: the first six show and "Show all 12" says how many there are. The button is a Tab stop and says it is collapsed. */
export const ManyTagsCollapsed = () => <TagList label="Labels" items={twelve} />;

/** The set starts open: every tag shows and the button reads "Show fewer". */
export const Expanded = () => <TagList label="Labels" items={twelve} defaultExpanded />;

/** The number that shows before the rest folds is the caller's: here, three. */
export const ThreeVisible = () => <TagList label="Labels" items={twelve} visible={3} />;

/** A value that is longer than the line is clamped to one line with an ellipsis; the whole pair is in the tooltip. The key is untouched. */
export const LongValueClamped = () => (
  <div className={styles.narrow}>
    <TagList
      label="Annotations"
      items={[
        { key: 'description', value: 'receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment' },
        { key: 'tier', value: 'backend' },
      ]}
    />
  </div>
);

/** A key that gives way keeps its end: the start is cut and the part after the last slash stays whole. */
export const LongKeyCut = () => (
  <div className={styles.narrow}>
    <TagList
      label="Labels"
      items={[
        { key: 'deployment.example.io/orders-api-managed-by', value: 'helm' },
        { key: 'app.example.io/managed-by', value: 'helm' },
      ]}
    />
  </div>
);

/** A key of more than 38 characters would fill the column by itself: its value is a chip of its own beside it, or under it when the line is full. */
export const LongKeyWithValueChip = () => (
  <div className={styles.narrow}>
    <TagList
      label="Annotations"
      items={[
        { key: 'deployment.example.io/last-applied-configuration-hash', value: 'a1b2c3d4' },
        { key: 'tier', value: 'backend' },
      ]}
    />
  </div>
);

/** A tag with no value shows its key alone. */
export const KeyWithoutValue = () => (
  <TagList label="Selectors" items={[{ key: 'orders-api' }, { key: 'tier', value: 'backend' }, { key: 'north-yard' }]} />
);

/** The 342 px column of a page's aside, with a mix of everything: the line wraps where the chips run out. */
export const NarrowBox = () => (
  <div className={styles.narrow}>
    <TagList
      label="Labels"
      items={[
        { key: 'app', value: 'orders-api' },
        { key: 'tier', value: 'backend' },
        { key: 'example.io/managed-by', value: 'helm' },
        { key: 'owner', value: 'north-yard' },
        { key: 'release', value: 'stable' },
        { key: 'canary' },
      ]}
    />
  </div>
);

/** Many chips in a wide box: the rows wrap and nothing overflows. */
export const ManyChipsWrapping = () => <TagList label="Labels" items={twelve} visible={12} />;
