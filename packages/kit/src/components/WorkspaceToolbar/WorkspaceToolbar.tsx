import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './WorkspaceToolbar.module.css';

export type WorkspaceToolbarProps = {
  /** Names the lane for assistive technology: what its controls are for ("Search and filter items"). */
  readonly label: string;
  /** The controls at the start of the lane, in order: the search field, the filters. */
  readonly children: ReactNode;
  /** The controls at the end of the lane: the Columns chooser. */
  readonly end?: ReactNode;
} & DataAttributes;

/**
 * The command lane of a collection (design 12 TB1, 13 N3): one flex line of 28 px controls, 8 px apart, wrapping when the room is short,
 * with its end group at the end. A surface has one lane; mode selectors, search and view switches live in it, and it carries no count
 * text (the footer's count is the one). It has no margin of its own: the gap under it belongs to the view that holds it. Props are
 * closed: no `className`, no `style`; `data-*` passes through.
 */
export function WorkspaceToolbar({ label, children, end, ...rest }: WorkspaceToolbarProps) {
  return (
    <div {...dataAttributes(rest)} className={styles.root} role="group" aria-label={label}>
      {children}
      {end === undefined || end === null ? null : (
        <div className={styles.end} data-ov-end="">
          {end}
        </div>
      )}
    </div>
  );
}
