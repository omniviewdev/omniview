import { KeyValue, Link, LinkProvider, MiddleEllipsis, Status, type KeyValueRow, type LinkTarget } from '@omniviewdev/kit';
import styles from './KeyValue.examples.module.css';

// A link that goes nowhere: the examples are about how a value looks.
const handler = {
  hrefOf: (target: LinkTarget) => `#/${target.page}`,
  onOpen: () => undefined,
};

// The facts of the mock's Details card, in the order it draws them.
const details: readonly KeyValueRow[] = [
  { label: 'Name', value: 'orders-api' },
  { label: 'Group', value: 'checkout' },
  { label: 'Created', value: '2026-11-13 09:42' },
  { label: 'Replicas', value: '3 desired, 3 ready' },
  { label: 'Strategy', value: 'Rolling update' },
  { label: 'Selector', value: 'app=orders-api', mono: true },
  { label: 'Image', value: 'registry.example.io/orders-api:1.8.2', mono: true },
  { label: 'Owner', value: 'north-yard' },
];

/** One pair per row: the label track is 130 px, the value starts 16 px after it, each row is 24 px high. */
export const OneColumn = () => (
  <KeyValue
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'Group', value: 'checkout' },
      { label: 'Created', value: '2026-11-13 09:42' },
    ]}
  />
);

/** Two columns, 24 px apart: the mock's Details card of eight facts. */
export const TwoColumns = () => <KeyValue columns={2} rows={details} />;

/** Three columns: below 900 px of its own width the list steps down to two, below 640 px to one. */
export const ThreeColumns = () => <KeyValue columns={3} rows={details} />;

/** The narrowest label track, 96 px, for short labels. */
export const LabelWidth96 = () => (
  <KeyValue
    labelWidth={96}
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'Group', value: 'checkout' },
    ]}
  />
);

/** The widest label track, 160 px, for labels of several words. */
export const LabelWidth160 = () => (
  <KeyValue
    labelWidth={160}
    rows={[
      { label: 'Minimum ready seconds', value: '0' },
      { label: 'Revision history limit', value: '10' },
    ]}
  />
);

/** A wide row spans every column of a many-column list: a long value that needs the whole line. */
export const WideRow = () => (
  <KeyValue
    columns={2}
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'Group', value: 'checkout' },
      { label: 'Description', value: 'Receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment.', wide: true },
      { label: 'Owner', value: 'north-yard' },
    ]}
  />
);

/** A missing value is the dash, named for what is missing: absent, null and an empty string all read "No <label>". */
export const MissingValues = () => (
  <KeyValue
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'Owner' },
      { label: 'Selector', value: null },
      { label: 'Description', value: '' },
    ]}
  />
);

/** A value is drawn as given: a status is the glyph and the platform's word. */
export const StatusValue = () => (
  <KeyValue
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'State', value: <Status role="running">Running</Status> },
      { label: 'Health', value: <Status role="healthy">Available</Status> },
    ]}
  />
);

/** A value may be a link: the link is a Tab stop, the list is not. */
export const LinkValue = () => (
  <LinkProvider handler={handler}>
    <KeyValue
      rows={[
        { label: 'Name', value: 'orders-api' },
        {
          label: 'Group',
          value: <Link to={{ page: 'groups', params: { name: 'checkout' } }}>checkout</Link>,
        },
        {
          label: 'Owner',
          value: <Link to={{ page: 'groups', params: { name: 'north-yard' } }}>north-yard</Link>,
        },
      ]}
    />
  </LinkProvider>
);

/** The code face for an identifier or a selector. */
export const CodeValue = () => (
  <KeyValue
    rows={[
      { label: 'Identifier', value: 'i-02048ad7d2f67a78c', mono: true },
      { label: 'Selector', value: 'app=orders-api,tier=backend', mono: true },
    ]}
  />
);

/** A value that is longer than the line wraps, and breaks inside a word only when it has no other place to; the row grows with it. */
export const LongValueWrapping = () => (
  <KeyValue
    rows={[
      { label: 'Description', value: 'Receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment, one line at a time.' },
      { label: 'Image', value: 'registry.example.io/platform/orders-api/orders-api-worker:1.8.2-rc1-with-a-very-long-tag', mono: true },
    ]}
  />
);

/** A value that is a `MiddleEllipsis` keeps its end when it is cut: the part that tells siblings apart stays whole. */
export const CutValue = () => (
  <KeyValue
    rows={[
      { label: 'Name', value: 'orders-api' },
      { label: 'Instance', value: <MiddleEllipsis tail={6}>orders-api-report-renderer-7d8c6f49b-7x5nx</MiddleEllipsis> },
    ]}
  />
);

/** The 342 px column of a page's aside, with two columns asked for: the list steps down to one by its own width, whatever the window is. */
export const NarrowBox = () => (
  <div className={styles.narrow}>
    <KeyValue columns={2} labelWidth={96} rows={details.slice(0, 5)} />
  </div>
);
