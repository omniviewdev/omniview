import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Link, type LinkTarget } from '../Link';
import { menuTrigger } from '../Menu';
import styles from './ResourceCard.module.css';

/** The facts a card holds are laid in this many columns at the most: more would leave each value too narrow to read. */
const MAX_METRICS = 3;

/** One fact of the card: a muted label over its value. A value is text or a value part (`MissingValue`, a `Status`), never a control. */
export type ResourceCardMetric = {
  readonly label: string;
  readonly value: ReactNode;
};

/** The state the card's border reports. Absent is neutral. A tone is never the only cue: the `status` says the same in words. */
export type ResourceCardTone = 'warning' | 'error';

export type ResourceCardProps = {
  /** The name of the thing. One line: a longer name is cut with an ellipsis, and the shared tip host shows all of it while it is cut. */
  readonly title: string;
  /** Makes the title a link to the thing (a native anchor; needs a `LinkProvider`). The card itself is never a control, so a card that navigates has a `to`. */
  readonly to?: LinkTarget | undefined;
  /** The 20 px visual before the title: an avatar, a `KindTile`. Decoration: the title names the card. */
  readonly lead?: ReactNode;
  /** The state, at the end of the title's line: a `Status`. */
  readonly status?: ReactNode;
  /** One muted line under the title (an identifier, an environment). Cut with an ellipsis like the title. */
  readonly meta?: string | undefined;
  /** Up to three facts in columns, under the identity. */
  readonly metrics?: readonly ResourceCardMetric[] | undefined;
  readonly tone?: ResourceCardTone | undefined;
  /** The commands of the card, in a footer under a rule: a `Button` and an `IconButton`. Each is its own Tab stop and a sibling of the title link. */
  readonly actions?: ReactNode;
  /**
   * Makes the card a context trigger of the owning view's menu: `id` is what `useMenu` returned, `key` names this card's record. The card registers nothing.
   * The card is not focusable, so the keyboard reaches the menu from a control inside it (Shift+F10 on the title link or a command): give a card with a
   * `menu` a `to` or `actions`.
   */
  readonly menu?: { readonly id: string; readonly key: string } | undefined;
} & DataAttributes;

/** A node that draws something: not absent, null, false or an empty string. */
const drawn = (node: ReactNode) => node !== undefined && node !== null && node !== false && node !== '';

/**
 * The one card of a thing in a collection (the mock's `H.resourceCard`, design 14 K1): the identity (a lead, the title, a status and one
 * muted line under it), up to three facts in columns, and a footer of commands, 12 px inside a 1 px edge. The title is the only way in: with
 * a `to` it is a link, and the commands are its siblings, so no control nests in another and the Tab stops are the link and the commands.
 * A card in a row of a `CardGrid` is as tall as its tallest neighbour: the facts and the footer sit on the card's bottom, so they line up
 * across the row whatever the lines above them.
 *
 * The card holds one `menu` trigger as attributes and registers nothing: Shift+F10 and the Menu key on the title or a command, and a
 * secondary click anywhere on the card, open the owning view's menu for this card's `key`. Props are closed: no `className`, no `style`;
 * `data-*` passes through.
 */
export function ResourceCard({ title, to, lead, status, meta, metrics, tone, actions, menu, ...rest }: ResourceCardProps) {
  if (metrics !== undefined && metrics.length > MAX_METRICS) {
    throw new TypeError(`A ResourceCard holds at most ${String(MAX_METRICS)} metrics; got ${String(metrics.length)}`);
  }

  const name = (
    <span className={styles.clip} data-ov-clip="">
      {title}
    </span>
  );

  // The trigger is attributes, so it goes where the caller's own `data-*` go; the popup is named after the card.
  const attributes = menu === undefined ? rest : { ...rest, ...menuTrigger(menu.id, menu.key, 'context'), 'data-ov-menu-label': `Actions for ${title}` };

  return (
    <div {...dataAttributes(attributes)} className={styles.root} data-ov-part="resource-card" data-ov-tone={tone}>
      <div className={styles.body} data-ov-part="body">
        <div className={styles.identity} data-ov-part="identity">
          {drawn(lead) ? (
            <span className={styles.lead} data-ov-part="lead">
              {lead}
            </span>
          ) : null}
          <span className={styles.name} data-ov-part="title">
            {to === undefined ? name : <Link to={to}>{name}</Link>}
          </span>
          {drawn(status) ? (
            <span className={styles.status} data-ov-part="status">
              {status}
            </span>
          ) : null}
          {meta === undefined || meta === '' ? null : (
            <span className={styles.meta} data-ov-part="meta" data-ov-clip="">
              {meta}
            </span>
          )}
        </div>
        {metrics === undefined || metrics.length === 0 ? null : (
          <dl className={styles.metrics} data-ov-part="metrics">
            {metrics.map((metric, index) => (
              <div key={`${String(index)}:${metric.label}`} className={styles.metric}>
                <dt className={styles.label} data-ov-clip="">
                  {metric.label}
                </dt>
                <dd className={styles.value} data-ov-clip="">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {drawn(actions) ? (
          <div className={styles.actions} data-ov-part="actions">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
