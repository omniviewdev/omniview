import { Fragment, type ReactElement } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Status, type StatusRole } from '../Status';
import styles from './StatusSummary.module.css';

/** The state a value or a text carries, by the roles of the design: it colours the item with the kit's state colours. The words still say what it is. */
export type StatusSummaryTone = 'success' | 'warning' | 'error' | 'info' | 'muted';

export type StatusSummaryItem =
  /** A `Status`: the glyph of its role and the platform's word. `queued` goes only with the role `progress`. */
  | { readonly status: { readonly role: StatusRole; readonly label: string; readonly queued?: boolean | undefined } }
  /** A bold value and what it counts: "3/3 ready". */
  | { readonly value: string; readonly label?: string | undefined; readonly tone?: StatusSummaryTone | undefined }
  /** A plain fact: "up to date". */
  | { readonly text: string; readonly tone?: StatusSummaryTone | undefined };

export type StatusSummaryProps = {
  /** Names the group ("orders-api status"). */
  readonly label: string;
  readonly items: readonly StatusSummaryItem[];
} & DataAttributes;

function itemOf(item: StatusSummaryItem): ReactElement {
  if ('status' in item) {
    const { role, label, queued } = item.status;
    return (
      <span className={styles.item} data-ov-part="item" data-ov-kind="status">
        {role === 'progress' ? (
          <Status role="progress" queued={queued}>
            {label}
          </Status>
        ) : (
          <Status role={role}>{label}</Status>
        )}
      </span>
    );
  }

  if ('value' in item) {
    return (
      <span className={styles.item} data-ov-part="item" data-ov-kind="value" data-ov-tone={item.tone}>
        <b>{item.value}</b>
        {item.label === undefined || item.label === '' ? null : ` ${item.label}`}
      </span>
    );
  }

  return (
    <span className={styles.item} data-ov-part="item" data-ov-kind="text" data-ov-tone={item.tone}>
      {item.text}
    </span>
  );
}

/**
 * The one line that leads an overview (design 12 FS1): "Available · 3/3 ready · up to date". Its parts are a status, a bold value with
 * what it counts, and plain text, in the order given, with a muted dot between them that assistive technology skips. It is 24 px high
 * at least, wraps when the line is long, and is a group named by the caller. A tone colours a value or a text; the words still say what
 * it is. With no items it draws nothing. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function StatusSummary({ label, items, ...rest }: StatusSummaryProps): ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div {...dataAttributes(rest)} className={styles.root} role="group" aria-label={label} data-ov-part="status-summary">
      {items.map((item, index) => (
        // The items are a list the caller gives in order and never reorders: the position is the identity.
        <Fragment key={index}>
          {index === 0 ? null : (
            <span className={styles.separator} data-ov-part="separator" aria-hidden="true">
              ·
            </span>
          )}
          {itemOf(item)}
        </Fragment>
      ))}
    </div>
  );
}
