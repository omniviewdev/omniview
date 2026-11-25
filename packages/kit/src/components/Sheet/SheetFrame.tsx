import type { ReactNode } from 'react';
import type { IconName } from '../Icon';
import { IconButton } from '../IconButton';
import { KindTile } from '../KindTile';
import styles from './Sheet.module.css';

/**
 * The size of a sheet. A dialog is `narrow` (440 px wide), `standard` (640) or `wide` (900), as high as its content up to the window, and its body scrolls (the mock's `.dlg`). `settings` is the fixed frame of the
 * Settings window, 1060 x 640 px, whose body clips and leaves the scrolling to its caller.
 */
export type SheetSize = 'narrow' | 'standard' | 'wide' | 'settings';

type SheetFrameProps = {
  /** The id of the title: what presents the frame names itself by it (`aria-labelledby`). */
  readonly titleId: string;
  readonly title: string;
  readonly size: SheetSize;
  readonly icon: IconName | undefined;
  readonly meta: string | undefined;
  readonly footer: ReactNode;
  /** The user asks to close: the Close control. */
  readonly onClose: () => void;
  readonly children: ReactNode;
};

/**
 * What a sheet shows, apart from how it is shown: a header (an icon when there is one, the title, a meta line when there is one, and Close at the end), the body, and the footer when there is one. It is the content
 * of `Sheet`, and nothing in it belongs to a modal: no dialog element, no backdrop, no focus trap, no Escape. It asks to close through `onClose` and does nothing else; the focus and the keyboard of the surface it is
 * presented on are that surface's, and so is the name it gives itself from `titleId`. It is internal to the part.
 */
export function SheetFrame({ titleId, title, size, icon, meta, footer, onClose, children }: SheetFrameProps) {
  const heading = (
    <h2 id={titleId} className={styles.title} data-ov-part="title">
      {title}
    </h2>
  );
  const hasMeta = meta !== undefined && meta !== '';
  const hasFooter = footer !== undefined && footer !== null && typeof footer !== 'boolean';
  return (
    <div className={styles.frame} data-ov-part="frame" data-ov-size={size}>
      <div className={styles.header} data-ov-part="header" data-ov-meta={hasMeta ? 'true' : undefined}>
        {icon === undefined ? null : <KindTile icon={icon} data-ov-part="icon" />}
        {hasMeta ? (
          <div className={styles.identity} data-ov-part="identity">
            {heading}
            <p className={styles.meta} data-ov-part="meta">
              {meta}
            </p>
          </div>
        ) : (
          heading
        )}
        <IconButton
          icon="close"
          label="Close"
          variant="ghost"
          size="row"
          data-ov-part="close"
          onClick={() => {
            onClose();
          }}
        />
      </div>
      <div className={styles.body} data-ov-part="body">
        {children}
      </div>
      {hasFooter ? (
        <div className={styles.footer} data-ov-part="footer">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
