import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import commandStyles from '../../shared/command.module.css';
import { useExpanded, type ExpandState } from '../Disclosure/useExpanded';
import { Icon } from '../Icon';
import styles from './SectionCard.module.css';

export type SectionCardProps = {
  readonly title: string;
  /** The heading's level: 2 for a section of a page (the page's one h1 is its header's), 3 or 4 below. The look is the same. Default 2. */
  readonly level?: 2 | 3 | 4 | undefined;
  /** A muted 12px fragment after the title (a count, a scope): "3". */
  readonly meta?: string | undefined;
  /** Commands at the end of the lane (ghost, compact `Button`s or `IconButton`s). */
  readonly actions?: ReactNode;
  /** The body sits on the section's inset (12px above and below): key-value rows, chips, text. A table sits flush: no `pad`. */
  readonly pad?: boolean | undefined;
  /**
   * Makes the body collapsible: the lane draws a chevron toggle as its last control, and the body is not mounted while closed. The
   * title, the meta and the actions stay. Controlled (`open` and `onOpenChange`) or uncontrolled (`defaultOpen`, closed when absent).
   */
  readonly collapse?: ExpandState | undefined;
  readonly children?: ReactNode;
} & DataAttributes;

const ALWAYS_OPEN = { open: true } as const;

const HEADINGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

/** A node that draws something: not absent, null, false or an empty string. */
const drawn = (node: ReactNode) => node !== undefined && node !== null && node !== false && node !== '';

/**
 * A section of a page: no box and no fill, a heading lane (28 px, a 1 px rule under it) and a body (the mock's `H.card`, design 12 section 13).
 * The lane holds the title (13/16, 600, a real `h2`, `h3` or `h4`: the heading is the page's outline, so the card itself is a plain `div`),
 * an optional muted fragment after it (a count, a scope), and the commands at the end. A body with `pad` sits on the 12 px inset; a table
 * sits flush. A command in the lane keeps the lane at its height when it is a `row` size button (24 px): the lane takes the button's
 * padding back. With `collapse` the body unmounts while closed. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function SectionCard({ title, level = 2, meta, actions, pad, collapse, children, ...rest }: SectionCardProps) {
  const Heading = HEADINGS[level];
  const { open, toggle, bodyId } = useExpanded(collapse ?? ALWAYS_OPEN);
  const hasBody = drawn(children) && open;
  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="section-card">
      <div className={styles.lane} data-ov-part="lane">
        <div className={styles.lead}>
          <Heading className={styles.heading} data-ov-part="heading" data-ov-clip="">
            {title}
          </Heading>
          {meta !== undefined && meta !== '' ? (
            <span className={styles.meta} data-ov-part="meta">
              {meta}
            </span>
          ) : null}
        </div>
        {drawn(actions) || collapse !== undefined ? (
          <div className={styles.actions} data-ov-part="actions">
            {actions}
            {collapse === undefined ? null : (
              <button
                type="button"
                className={commandStyles.root}
                data-ov-shape="icon"
                data-ov-variant="ghost"
                data-ov-tone="neutral"
                data-ov-size="row"
                data-ov-part="toggle"
                aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
                aria-expanded={open}
                aria-controls={hasBody ? bodyId : undefined}
                onClick={toggle}
              >
                <Icon name={open ? 'chevron-up' : 'chevron-down'} />
              </button>
            )}
          </div>
        ) : null}
      </div>
      {hasBody ? (
        <div id={collapse === undefined ? undefined : bodyId} className={styles.body} data-ov-part="body" data-ov-pad={pad === true ? 'true' : undefined}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
