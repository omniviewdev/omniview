import { Icon, IconButton, Link, LinkProvider, ListRows, Status, type LinkTarget } from '@omniviewdev/kit';
import styles from './ListRows.examples.module.css';

// A link that goes nowhere: the example is about how a row holds it.
const handler = {
  hrefOf: (target: LinkTarget) => `#/${target.page}`,
  onOpen: () => undefined,
};

/** A title and nothing else: one line, 24 px high. */
export const TitleOnly = () => (
  <ListRows
    label="Groups"
    rows={[
      { id: 'checkout', title: 'checkout' },
      { id: 'north-yard', title: 'north-yard' },
    ]}
  />
);

/** A title over a muted detail line: the row is as tall as its two lines. */
export const TitleAndDetail = () => (
  <ListRows
    label="Releases"
    rows={[
      { id: 'one', title: 'orders-api', detail: 'Rolled out 3 days ago' },
      { id: 'two', title: 'orders-worker', detail: 'Rolled out 5 days ago' },
    ]}
  />
);

/** A trailing muted value at the end of the row: an age, a count. Every row shares the meta column. */
export const WithMeta = () => (
  <ListRows
    label="Releases"
    rows={[
      { id: 'one', title: 'orders-api', meta: '3d' },
      { id: 'two', title: 'orders-worker', meta: '12d' },
      { id: 'three', title: 'inventory-sync' },
    ]}
  />
);

/** A glyph before the text. A row without one leaves its cell empty, so the text of every row starts at the same x. */
export const WithIcon = () => (
  <ListRows
    label="Checks"
    rows={[
      { id: 'one', title: 'Readiness', icon: <Icon name="status-success" /> },
      { id: 'two', title: 'Liveness', icon: <Icon name="status-warning" /> },
      { id: 'three', title: 'Startup' },
    ]}
  />
);

/** A status in the glyph cell: the glyph of its role and the platform's word. */
export const WithStatus = () => (
  <ListRows
    label="Checks"
    rows={[
      { id: 'one', title: 'Readiness', icon: <Status role="healthy">Passed</Status> },
      { id: 'two', title: 'Liveness', icon: <Status role="error">Failed</Status> },
    ]}
  />
);

/** All four: a glyph, a title over its detail, and the trailing value. */
export const AllFour = () => (
  <ListRows
    label="Recent events"
    rows={[
      { id: 'one', title: 'Scaled up', detail: 'orders-api from 2 to 3 replicas', meta: '2m', icon: <Icon name="layers" /> },
      { id: 'two', title: 'Restarted', detail: 'orders-api in north-yard', meta: '1h', icon: <Icon name="refresh" /> },
    ]}
  />
);

/** A title that is a link: the row is text and the link is the row's only Tab stop. */
export const WithLink = () => (
  <LinkProvider handler={handler}>
    <ListRows
      label="Owners"
      rows={[
        { id: 'one', title: <Link to={{ page: 'groups', params: { name: 'north-yard' } }}>north-yard</Link>, detail: 'Platform' },
        { id: 'two', title: <Link to={{ page: 'groups', params: { name: 'checkout' } }}>checkout</Link>, detail: 'Storefront' },
      ]}
    />
  </LinkProvider>
);

/** A title and a detail that are longer than the line clip to one line each, with an ellipsis; the meta keeps its place. */
export const LongClipped = () => (
  <div className={styles.narrow}>
    <ListRows
      label="Recent warnings"
      rows={[
        {
          id: 'one',
          title: 'Readiness probe failed for the orders-api container in the north-yard group',
          detail: 'Container orders-api: readiness probe failed: connection refused while dialling the inventory service on port 8443',
          meta: '2m',
          icon: <Icon name="status-warning" />,
        },
      ]}
    />
  </div>
);

/** Three rows as the Recent warnings card of a detail page's aside draws them: a warning glyph, the reason over its message, the age. */
export const RecentWarnings = () => (
  <div className={styles.narrow}>
    <ListRows
      label="Recent warnings"
      rows={[
        { id: 'one', title: 'FailedScheduling', detail: 'Container orders-api: readiness probe failed: connection refused', meta: '2m', icon: <Icon name="status-warning" /> },
        { id: 'two', title: 'BackOff', detail: 'Back-off restarting failed container', meta: '11m', icon: <Icon name="status-warning" /> },
        { id: 'three', title: 'Unhealthy', detail: 'Liveness probe failed: HTTP 503', meta: '3d', icon: <Icon name="status-warning" /> },
      ]}
    />
  </div>
);

const noop = () => undefined;

/** A row that is a button: its cells are one control and one Tab stop. */
export const Actionable = () => (
  <ListRows
    label="Saved views"
    rows={[
      { id: 'one', title: 'Production', detail: '12 connections', icon: <Icon name="server" />, onActivate: noop },
      { id: 'two', title: 'Staging', detail: '4 connections', icon: <Icon name="server" />, onActivate: noop },
    ]}
  />
);

/** A row that is a link: a native anchor to a destination in the host. */
export const AsLink = () => (
  <LinkProvider handler={handler}>
    <ListRows
      label="Groups"
      rows={[
        { id: 'one', title: 'north-yard', detail: 'Platform', to: { page: 'groups', params: { name: 'north-yard' } } },
        { id: 'two', title: 'checkout', detail: 'Storefront', to: { page: 'groups', params: { name: 'checkout' } } },
      ]}
    />
  </LinkProvider>
);

/** One row of the list is selected: a toggle, `aria-pressed`, with the selected fill. */
export const Selected = () => (
  <ListRows
    label="Saved views"
    rows={[
      { id: 'one', title: 'Production', onActivate: noop, selected: true },
      { id: 'two', title: 'Staging', onActivate: noop, selected: false },
    ]}
  />
);

/** A row that cannot be activated says why: it stays focusable and the reason is its description. */
export const DisabledWithReason = () => (
  <ListRows
    label="Saved views"
    rows={[
      { id: 'one', title: 'Production', onActivate: noop },
      { id: 'two', title: 'Archive', detail: 'Read only', onActivate: noop, disabledReason: 'Archived views cannot be opened' },
    ]}
  />
);

/** One control after the row: a sibling of the row's button, its own Tab stop. */
export const AsideOneControl = () => (
  <ListRows
    label="Members"
    rows={[
      { id: 'one', title: 'Connection A', detail: 'Production', icon: <Icon name="server" />, aside: <IconButton icon="close" label="Remove Connection A" size="row" variant="ghost" onClick={noop} /> },
      { id: 'two', title: 'Connection B', detail: 'Staging', icon: <Icon name="server" />, aside: <IconButton icon="close" label="Remove Connection B" size="row" variant="ghost" onClick={noop} /> },
    ]}
  />
);

/** Two controls after an actionable row, with a meta and a tip: every row's columns line up. */
export const AsideTwoControls = () => (
  <ListRows
    label="Members"
    rows={[
      {
        id: 'one',
        title: 'Connection A',
        detail: 'Production',
        meta: '3d',
        icon: <Icon name="server" />,
        onActivate: noop,
        tip: 'Open Connection A',
        aside: (
          <>
            <IconButton icon="refresh" label="Refresh Connection A" size="row" variant="ghost" onClick={noop} />
            <IconButton icon="close" label="Remove Connection A" size="row" variant="ghost" onClick={noop} />
          </>
        ),
      },
      { id: 'two', title: 'Connection B', detail: 'Staging', meta: '12d', icon: <Icon name="server" />, onActivate: noop },
    ]}
  />
);
