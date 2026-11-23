import { Button } from '@omniviewdev/kit';
import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CloseResult } from '../../core/panel';
import { rememberFocus, restoreFocus } from '../../palette/focus';
import { focusTab } from '../focus';
import type { ClosePrompt as Prompt, CloseGuard } from './closeGuard';
import { TERMINAL_TOOL_ID } from './tool';
import styles from './ClosePrompt.module.css';

// The question a close of a running terminal asks (ch16 S115, decision L12): a modal dialog with the question as its title, a sentence of what it does, and two buttons, Cancel (which has the keyboard, so
// Enter on it is "no" and a key that is pressed twice by mistake ends nothing) and Terminate session. It is the browser's own modal (`showModal`), as the palette is: the top layer, the rest of the window
// inert, Escape and a press outside it say no, and the focus goes back where it was when that is a real control (a keyboard close left it on the tab or in the emulator); when it was on the pointer-only close
// button of the tab, or on something that is gone, it goes to the session's tab instead. After a yes the focus goes where the shell's own close paths send it: the neighbouring tab, or the tool's tab when
// it was the last session.

/**
 * Whether the element that had the focus is a real control, one the focus may come back to: it is still in the document, it is not disabled, it is not hidden or inert, and it is neither `aria-hidden` nor
 * inside a subtree that is (the pointer-only aids of the shell, such as the close button of a tab, are all three of "out of the tab order", "nameless" and `aria-hidden`: a focus on one reaches no one
 * who uses a keyboard or a screen reader). A `tabindex` of -1 alone does not decide it: the tabs of a strip that is not on its tab stop have it and are controls.
 */
function isRealControl(element: HTMLElement | null): element is HTMLElement {
  return (
    element !== null &&
    element.isConnected &&
    element.closest('[aria-hidden="true"], [inert], [hidden]') === null &&
    !element.matches(':disabled')
  );
}

/** Whether the panel draws a tab for the session now: the question may outlive the tab it was about. */
function hasSessionTab(session: string): boolean {
  return [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTabs"] [role="tab"]')].some((tab) => tab.dataset.tabId === session);
}

type PromptDialogProps = { readonly guard: CloseGuard; readonly prompt: Prompt };

/** The dialog while a question is on screen: mounting is opening, and leaving gives the focus back once the dialog is gone (a modal that is still there would keep the window inert). */
function PromptDialog({ guard, prompt }: PromptDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  /** What the person said, for the focus to follow once the dialog is gone: nothing for a no. */
  const answered = useRef<CloseResult | undefined>(undefined);
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return undefined;
    }

    const remembered = rememberFocus();
    if (!element.open) {
      element.showModal();
    }

    element.querySelector<HTMLElement>('[data-close-prompt="cancel"]')?.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        const result = answered.current;
        if (result?.status === 'done') {
          // The session is gone, and so is the tab that had the focus: the neighbour takes it, or the tool's own tab when it was the last.
          if (result.active === null) {
            focusTab('panelTools', TERMINAL_TOOL_ID);
          } else {
            focusTab('sessionTabs', result.active);
          }

          return;
        }

        if (isRealControl(remembered.element)) {
          restoreFocus(remembered);
          return;
        }

        // What had the focus is not a place to come back to (the close button of a tab, which a mouse press reaches and no key or screen reader does; or an element that is gone). Nothing else has taken the
        // focus meanwhile: the session's tab takes it, or the tool's own tab when the session has none.
        const { activeElement } = document;
        if (activeElement === null || activeElement === document.body || activeElement === document.documentElement) {
          if (hasSessionTab(prompt.session)) {
            focusTab('sessionTabs', prompt.session);
          } else {
            focusTab('panelTools', TERMINAL_TOOL_ID);
          }
        }
      });
    };
  }, [prompt.session]);

  return (
    <dialog
      ref={dialog}
      className={styles.scrim}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-shell-part="closePrompt"
      onCancel={(event) => {
        // Escape: the browser would close the dialog itself, and the guard would still be asking.
        event.preventDefault();
        guard.cancel();
      }}
      onClick={(event) => {
        // A press on the scrim, outside the frame, is a no.
        if (event.target === event.currentTarget) {
          guard.cancel();
        }
      }}
    >
      <div className={styles.frame}>
        <h2 id={titleId} className={styles.title}>
          {prompt.question.title}
        </h2>
        <p className={styles.name} dir="auto">
          {prompt.name}
        </p>
        <p id={bodyId} className={styles.body}>
          {prompt.question.body}
        </p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            data-close-prompt="cancel"
            onClick={() => {
              guard.cancel();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            tone="danger"
            data-close-prompt="confirm"
            onClick={() => {
              answered.current = guard.confirm();
            }}
          >
            {prompt.question.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** The dialog of a window's close guard: nothing while nothing is asked. */
export function ClosePrompt({ guard }: { readonly guard: CloseGuard }) {
  const prompt = useSyncExternalStore(guard.subscribe, guard.getSnapshot);
  return prompt === null ? null : <PromptDialog key={prompt.session} guard={guard} prompt={prompt} />;
}
