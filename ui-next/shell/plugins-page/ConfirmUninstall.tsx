import { Button, IconButton, Text } from '@omniviewdev/kit';
import { useId, useLayoutEffect, useRef } from 'react';
import { rememberFocus, restoreFocus } from '../palette/focus';
import type { UninstallWords } from './core/words';
import styles from './ConfirmUninstall.module.css';

// The Uninstall confirm (ch16 S136): one modal dialog that says what removing a plugin does and asks once. It is rendered only while it is open, so the page owns whether it is there and mounting is opening. The
// dialog is the browser's own modal, as the palette's is (`showModal`: the top layer, the rest of the window inert, Tab kept inside). Escape, the close X, Cancel and a press on the scrim all say no; only the
// confirm says yes. The host's call has no option, so no choice is drawn. The words are the host's, from `uninstallWords`.

export type ConfirmUninstallProps = {
  readonly words: UninstallWords;
  /** The plugin's version, drawn under the title so the person sees which build is going. */
  readonly version: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmUninstall({ words, version, onConfirm, onCancel }: ConfirmUninstallProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const introId = `${ids}-intro`;
  const dialog = useRef<HTMLDialogElement>(null);

  // Mounting is opening: the element that has the focus is remembered, the dialog goes modal, and Cancel takes the keyboard (a browser would give it to the first control, the X; a destructive confirm never
  // defaults to the destructive action). Leaving closes the dialog, which gives the focus back to the opener in a browser; the remembered element is the same answer where the engine does not, and once the
  // markup is gone, because a modal that is still there would keep the rest of the window inert.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return undefined;
    }

    const remembered = rememberFocus();
    if (!element.open) {
      element.showModal();
    }

    element.querySelector<HTMLElement>('[data-pl-part="confirm-cancel"]')?.focus({ preventScroll: true });
    return () => {
      element.close();
      queueMicrotask(() => {
        restoreFocus(remembered);
      });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.scrim}
      aria-labelledby={titleId}
      aria-describedby={introId}
      data-pl-part="confirm"
      onPointerDown={(event) => {
        // A press on the scrim, outside the box, says no; a press inside never does.
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onCancel={(event) => {
        // Escape is the browser's close request. The page decides whether the dialog goes: it is not closed behind it, so it cannot be left open with nothing that owns it, or gone with nothing told.
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.box}>
        <div className={styles.head}>
          <div className={styles.identity}>
            <div id={titleId}>
              <Text as="h2" variant="title" data-pl-part="confirm-title">
                {words.title}
              </Text>
            </div>
            <Text as="p" tone="muted" data-pl-part="confirm-version">
              {version}
            </Text>
          </div>
          <IconButton icon="close" label="Close" variant="ghost" onClick={onCancel} data-pl-part="confirm-close" />
        </div>
        <div className={styles.body}>
          <div id={introId} data-pl-part="confirm-body">
            <Text as="p">{words.intro}</Text>
          </div>
          {words.sections.map((section) => (
            <div key={section.heading} className={styles.section} data-pl-part="confirm-section">
              <Text as="h3" variant="title">
                {section.heading}
              </Text>
              <Text as="p">{section.text}</Text>
            </div>
          ))}
        </div>
        <div className={styles.foot}>
          <Button onClick={onCancel} data-pl-part="confirm-cancel">
            Cancel
          </Button>
          <Button variant="primary" tone="danger" onClick={onConfirm} data-pl-part="confirm-confirm">
            {words.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
