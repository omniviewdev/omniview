import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { IconName } from '../Icon';
import { opener, restoreFocus, tabStops, wrapTarget } from './focus';
import { SheetFrame, type SheetSize } from './SheetFrame';
import styles from './Sheet.module.css';

export type SheetProps = {
  /** The visible title of the sheet and its accessible name. */
  readonly title: string;
  /** The user asks to close: Escape, or the Close control. The sheet never closes itself: mounting is opening, so the caller stops rendering it. */
  readonly onClose: () => void;
  /** The body, under the header. In a dialog size it is padded 12 px, takes the caller's content as it flows and is the one thing that scrolls; in `settings` it fills the frame and clips, and whatever scrolls inside it scrolls itself. */
  readonly children: ReactNode;
  /** The frame: `narrow` (440 px), `standard` (640 px, the default) or `wide` (900 px), each as high as its content up to the window; or `settings`, the fixed 1060 x 640 px of the Settings window. */
  readonly size?: SheetSize | undefined;
  /** A glyph in a 20 px tile before the title. Decoration: the title names the dialog. */
  readonly icon?: IconName | undefined;
  /** A muted line under the title: what the dialog is about, in a few words. */
  readonly meta?: string | undefined;
  /** The actions of the dialog, a `FormActions`: under the body and outside it, so that they stay where they are while the body scrolls. */
  readonly footer?: ReactNode;
  /** The id of the element of the body that says what the dialog is for. It becomes `aria-describedby`: a screen reader reads it after the title when the dialog opens. */
  readonly describedBy?: string | undefined;
} & DataAttributes;

/**
 * A modal dialog in the window, over the page: a header (an icon when there is one, the title, a meta line when there is one, and Close at its end), a body the caller lays out, and a footer for the actions when there
 * is one. It is the browser's own modal, a native `dialog` opened with `showModal()`: in the top layer, so nothing needs a z-index, and the rest of the window inert. The dialog is itself the scrim and covers the whole
 * window, drawing nothing of its own; the frame inside it has a `size`: a `narrow`, `standard` (the default) or `wide` dialog as high as its content up to the window, whose body is the one scroller, or `settings`, the
 * fixed 1060 x 640 px of the old Settings window, whose caller lays out its own scrollers.
 *
 * Naming: a `Sheet` is the modal dialog, and it keeps the name. The mock's `.sheet` is something else, the drawer at the right-hand side of the window; that will be a separate inspector part, never a variant of this one.
 *
 * Two layers: the content (the header, the body and the footer, `SheetFrame`) knows nothing of how it is presented, and the modal (the dialog element, Escape, Tab and the focus) is a thin layer around it. What goes in
 * the body and the footer must not lean on the modal either: no reliance on a dialog ancestor, a backdrop or the top layer, and a control that wants the focus takes it in its own effect.
 *
 * Mounting is opening and unmounting is closing, so the caller owns whether it is open and the sheet never closes itself: Escape and the Close control only ask (`onClose`). A press on the scrim asks nothing: a form
 * must not lose its draft to an accidental click, so only Escape and Close close it. Escape is the browser's `cancel` event on the dialog, never a key of the part's own, so a control that handled Escape itself (a field
 * with a draft, a select's open popup) never reaches the dialog. Tab wraps from the last control to the first and from the first to the last, found when the key is pressed.
 *
 * The control that opened the sheet gets the focus back when it closes, if it is still in the document and the focus is lost; the caller decides where it goes otherwise. It must hold the focus when it opens the
 * sheet (a Mac browser does not focus a button that was pressed, so the opener takes it itself). The part picks no field to focus: when nothing in the body takes the focus (a field that focuses itself in its own
 * effect wins, as `TextInput` does with `autoFocus`), the first control, Close, has it. Props are closed: no `className`, no `style`; `data-*` passes through to the dialog.
 */
export function Sheet({ title, onClose, children, size = 'standard', icon, meta, footer, describedBy, ...rest }: SheetProps) {
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
    const kept = memory.current ?? { element: opener(doc) };
    memory.current = kept;
    const { element: remembered } = kept;
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
      aria-describedby={describedBy}
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
      <SheetFrame titleId={titleId} title={title} size={size} icon={icon} meta={meta} footer={footer} onClose={onClose}>
        {children}
      </SheetFrame>
    </dialog>
  );
}
