import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import { Link, type LinkTarget } from '../Link';
import { tip } from '../TooltipHost';
import styles from './IdentityCell.module.css';

/** A small glyph after the name that says something about it (pinned, read-only). It is drawn whole, and its label is read and never drawn. */
export type IdentityMark = {
  readonly icon: IconName;
  /** What the glyph says, in a word: "Pinned". Assistive technology reads it, and it is the glyph's tooltip. */
  readonly label: string;
};

export type IdentityCellProps = {
  /** The name, on one line. When the line is too short the name gives way with an ellipsis, and its whole text is the tooltip while it is cut. */
  readonly name: string;
  /** Makes the name a link to a destination in the host (needs a `LinkProvider`): the cell's one Tab stop. Without it the name is text. */
  readonly to?: LinkTarget | undefined;
  /** What stands before the name, in its own slot: an `Avatar` or a `KindTile` of 16 px. */
  readonly lead?: ReactNode;
  /** Glyphs after the name, 12 px and muted. They never give way: the name does. */
  readonly marks?: readonly IdentityMark[] | undefined;
  /** A muted second line, clipped on its own. */
  readonly detail?: string | undefined;
} & DataAttributes;

/**
 * The identity of a row: what stands for it, its name, the marks that say something about it, and a muted line under. It fills the width
 * its parent gives it, and when that is short the text gives way, never a mark or the lead. In a `DataTable` it is the cell of the `fit: 'id'`
 * column: `lead` is the lead's width and its 8 px gap (24 for a 16 px lead), `trail` is 16 for a mark (12 px and a 4 px gap), and a detail
 * line makes the table `lines={2}`. It is pure: no state, no effect. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function IdentityCell({ name, to, lead, marks, detail, ...rest }: IdentityCellProps) {
  const text = (
    <span className={styles.name} data-ov-part="name" data-ov-clip="">
      {name}
    </span>
  );

  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="identity">
      {lead === undefined || lead === null || lead === false ? null : (
        <span className={styles.lead} data-ov-part="lead">
          {lead}
        </span>
      )}
      <div className={styles.lines}>
        <div className={styles.nameLine}>
          {to === undefined ? text : <Link to={to}>{text}</Link>}
          {marks?.map((mark) => (
            <span key={mark.label} {...dataAttributes(tip(mark.label))} className={styles.mark} data-ov-part="mark">
              <Icon name={mark.icon} size={12} />
              <span className={styles.label}>{mark.label}</span>
            </span>
          ))}
        </div>
        {detail === undefined ? null : (
          <span className={styles.detail} data-ov-part="detail" data-ov-clip="">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
