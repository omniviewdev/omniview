import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { IconButton } from '../IconButton';
import { opener, restoreFocus, tabStops, wrapTarget } from './focus';
import styles from './Sheet.module.css';

export type SheetProps = {
  /** The visible title of the sheet and its accessible name. */
  readonly title: string;
  /** The user asks to close: Escape, or the Close control. The sheet never closes itself: mounting is opening, so the caller stops rendering it. */
  readonly onClose: () => void;
  /** The body: it fills the sheet under the header and clips; whatever scrolls inside it scrolls itself. */
  readonly children: ReactNode;
} & DataAttributes;

/**
 * A modal surface in the window, over the page: a header (the title, and Close at its end) and a body the caller lays out. It is the browser's own modal, a native `dialog` opened with `showModal()`: in the top
 * layer, so nothing needs a z-index, and the rest of the window inert. The dialog is itself the scrim and covers the whole window, drawing nothing of its own; the frame inside it is one size so far, 1060 x 640 px,
 * the size of the old Settings window and the one screen that needs it. The next screen that needs another size adds a `size` prop; there is none now, so no option is dead.
 *
 * Mounting is opening and unmounting is closing, so the caller owns whether it is open and the sheet never closes itself: Escape and the Close control only ask (`onClose`). A press on the scrim asks nothing: a form
 * must not lose its draft to an accidental click, so only Escape and Close close it. Escape is the browser's `cancel` event on the dialog, never a key of the part's own, so a control that handled Escape itself (a field
 * with a draft, a select's open popup) never reaches the dialog. Tab wraps from the last control to the first and from the first to the last, found when the key is pressed.
 *
 * The control that opened the sheet gets the focus back when it closes, if it is still in the document and the focus is lost; the caller decides where it goes otherwise. It must hold the focus when it opens the
 * sheet (a Mac browser does not focus a button that was pressed, so the opener takes it itself). The part picks no field to focus: when nothing in the body takes the focus (a search field that focuses itself in
 * its own effect wins), the first control, Close, has it. Props are closed: no `className`, no `style`; `data-*` passes through to the dialog.
 */
export function Sheet({ title, onClose, children, ...rest }: SheetProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  /** The element that had the focus when the sheet opened, kept once: React runs the effect again in StrictMode, and by then the dialog holds the focus. */
  const memory = useRef<{ readonly element: HTMLElement | null } | null>(null);

  // Mounting is opening: the element that has the focus is remembered, and the dialog goes modal unless it already is. A real engine moves the focus into the dialog as it opens; where nothing did, the first
  // control takes it. A child's own passive effect runs after this one, so a field that focuses itself wins. Leaving gives the focus back once the dialog is gone (a modal that is still there would keep the
  // rest of the window inert, and the cleanup runs before React removes the element).
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return undefined;
    }

    const doc = element.ownerDocument;
    memory.current ??= { element: opener(doc) };
    const { element: remembered } = memory.current;
    if (!element.open) {
      element.showModal();
    }

    if (!element.contains(doc.activeElement)) {
      tabStops(element)[0]?.focus();
    }

    return () => {
      queueMicrotask(() => {
        restoreFocus(doc, remembered);
      });
    };
  }, []);

  return (
    <dialog
      {...dataAttributes(rest)}
      ref={dialog}
      className={styles.scrim}
      aria-labelledby={titleId}
      data-ov-part="sheet"
      onCancel={(event) => {
        // Escape is the browser's close request, and it is the caller's to answer: the browser does not close the dialog behind it.
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        // The browser makes the rest of the window inert, but an engine may still let Tab go to its own chrome or to the document: the ends wrap. Option+Tab is the Mac's Tab through every control. A chord (Control or
        // Command with Tab) is not a move of the focus, a Tab that a control handled is that control's, and one that is part of a composition is the input method's.
        if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) {
          return;
        }

        const to = wrapTarget(event.currentTarget, event.shiftKey);
        if (to !== null) {
          event.preventDefault();
          to.focus();
        }
      }}
    >
      <div className={styles.frame} data-ov-part="frame">
        <div className={styles.header} data-ov-part="header">
          <h2 id={titleId} className={styles.title} data-ov-part="title">
            {title}
          </h2>
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
      </div>
    </dialog>
  );
}
