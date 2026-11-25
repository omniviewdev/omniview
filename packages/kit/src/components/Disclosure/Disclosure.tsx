import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import styles from './Disclosure.module.css';
import { useExpanded, type ExpandState } from './useExpanded';

export type DisclosureProps = {
  readonly title: string;
  /** A muted 12px fragment at the end of the trigger: a count, a summary ("AND · 2"). */
  readonly meta?: string | undefined;
  /** The heading's level: 3 below a section of a page, 4 below that. The look is the same. Default 3. */
  readonly level?: 3 | 4 | undefined;
  /** A control before the trigger (a select-all checkbox). It is a sibling of the heading, never inside the trigger. */
  readonly lead?: ReactNode;
  /** A control after the trigger (a Remove button). A sibling of the heading too. */
  readonly aside?: ReactNode;
  /** The body. It is mounted only while the disclosure is open. */
  readonly children?: ReactNode;
} & ExpandState &
  DataAttributes;

/** A node that draws something: not absent, null, false or an empty string. */
const drawn = (node: ReactNode) => node !== undefined && node !== null && node !== false && node !== '';

/**
 * A heading with one full-width trigger button (chevron, title, muted meta) over a body that is mounted only while open, for an
 * accordion section or a row that unfolds its detail. Controlled (`open` and `onOpenChange`) or uncontrolled (`defaultOpen`). The
 * trigger is a native button inside an `h3` or `h4` with `aria-expanded`; the body is a labelled region that `aria-controls` names
 * while it exists. `lead` and `aside` are their own Tab stops. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function Disclosure({ title, meta, level = 3, lead, aside, children, open: controlled, defaultOpen, onOpenChange, ...rest }: DisclosureProps) {
  const { open, toggle, triggerId, bodyId } = useExpanded({ open: controlled, defaultOpen, onOpenChange });
  const Heading = level === 4 ? 'h4' : 'h3';
  const hasBody = open && drawn(children);
  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="disclosure" data-ov-open={open ? 'true' : undefined}>
      <div className={styles.bar} data-ov-part="bar">
        {drawn(lead) ? (
          <div className={styles.side} data-ov-part="lead">
            {lead}
          </div>
        ) : null}
        <Heading className={styles.heading} data-ov-part="heading">
          <button type="button" id={triggerId} className={styles.trigger} aria-expanded={open} aria-controls={hasBody ? bodyId : undefined} onClick={toggle}>
            <Icon name="chevron-right" />
            <span className={styles.title}>{title}</span>
            {meta !== undefined && meta !== '' ? (
              <span className={styles.meta} data-ov-part="meta">
                {meta}
              </span>
            ) : null}
          </button>
        </Heading>
        {drawn(aside) ? (
          <div className={styles.side} data-ov-part="aside">
            {aside}
          </div>
        ) : null}
      </div>
      {hasBody ? (
        <div id={bodyId} className={styles.body} role="region" aria-labelledby={triggerId} data-ov-part="body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
