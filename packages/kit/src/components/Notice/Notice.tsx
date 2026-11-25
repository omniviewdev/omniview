import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import styles from './Notice.module.css';

/** The state a notice reports, by the roles of the design: its border, fill and glyph take the role. A tone is never the only cue: the glyph and the words carry it. */
export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export type NoticeProps = {
  /** Picks the status glyph and the colours. Default `info`. */
  readonly tone?: NoticeTone | undefined;
  /** A bold lead sentence before the message. */
  readonly title?: string | undefined;
  /** The message. It wraps. */
  readonly children: string;
  /** Makes the notice a live region: `alert` for a problem that appears after an action, `status` for a result. Absent, it is plain content. */
  readonly live?: 'alert' | 'status' | undefined;
  /** Commands at the end (compact `Button`s such as Retry): at most two. */
  readonly actions?: ReactNode;
} & DataAttributes;

const GLYPHS: Readonly<Record<NoticeTone, IconName>> = {
  info: 'status-info',
  success: 'status-success',
  warning: 'status-warning',
  error: 'status-error',
};

/**
 * An inline message in a box tinted by its tone: a 16 px status glyph, 13/16 text (a bold title and the message) and the commands at
 * the end. It is a live region only when asked (`live`). Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function Notice({ tone = 'info', title, children, live, actions, ...rest }: NoticeProps) {
  const hasTitle = title !== undefined && title !== '';
  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="notice" data-ov-tone={tone} role={live}>
      <span className={styles.glyph}>
        <Icon name={GLYPHS[tone]} />
      </span>
      <div className={styles.body} data-ov-part="message">
        {hasTitle ? <strong className={styles.title}>{title}</strong> : null}
        {hasTitle ? ' ' : null}
        {children}
      </div>
      {actions !== undefined && actions !== null && actions !== false && actions !== '' ? (
        <div className={styles.actions} data-ov-part="actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
