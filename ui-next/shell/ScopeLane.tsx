import { Icon, Text, tip } from '@omniviewdev/kit';
import { useId, useRef, useState } from 'react';
import type { ShellLaneFace, ShellScopeFace, ShellScopePicker } from './registration';
import { ScopePicker } from './ScopePicker';
import styles from './ScopeLane.module.css';

type ScopeLaneProps = {
  readonly label: string;
  readonly faces: readonly ShellLaneFace[] | undefined;
};

/** What a face says, drawn: its glyph, and what it is (read, never drawn) with its value. */
function Inside({ face }: { readonly face: ShellScopeFace }) {
  return (
    <>
      <span className={styles.glyph}>
        <Icon name={face.icon} />
      </span>
      <span className={styles.value}>
        <span className={styles.what}>{`${face.label}: `}</span>
        <Text>{face.text}</Text>
      </span>
    </>
  );
}

/** What the picker was opened on: the button it hangs from, and the value the face said then. */
type Opened = { readonly anchor: HTMLButtonElement; readonly current: string | undefined };

/**
 * A face the host made a control (HM1): ONE native button, so a Tab stop, in the box of a face with a 12 px chevron after its value. Enter, Space, ArrowDown and a click open its picker; the picker is mounted only while it is
 * open. When the face's value becomes another than the one it opened on (the host chose), the picker has done its work and closes.
 */
function PickerFace({ face, picker }: { readonly face: ShellLaneFace; readonly picker: ShellScopePicker }) {
  const popupId = useId();
  const [opened, setOpened] = useState<Opened | null>(null);
  /** Whether the picker was open when the pointer pressed the button. The browser's light dismiss closes the picker on that press or on its release, before or after the click: the click must close it, never open it again. */
  const pressedOpen = useRef<boolean | null>(null);

  // Cleared here, not by the picker, so that it does not come back when the value turns back to the one it opened on.
  if (opened !== null && opened.current !== picker.current) {
    setOpened(null);
  }

  const open = (anchor: HTMLButtonElement): void => {
    picker.onOpen?.();
    setOpened({ anchor, current: picker.current });
  };

  return (
    <>
      <button
        type="button"
        className={styles.control}
        aria-label={`${face.label}: ${face.text}`}
        aria-haspopup="listbox"
        aria-expanded={opened !== null}
        aria-controls={opened === null ? undefined : popupId}
        data-shell-part="scopeFace"
        data-scope-face={face.label}
        {...tip(face.text)}
        onPointerDown={() => {
          pressedOpen.current = opened !== null;
        }}
        onClick={(event) => {
          // A click made by a pointer (detail 1 or more) answers the press before it; one made by the keyboard (Enter, Space) answers what the picker is now.
          const wasOpen = event.detail > 0 && pressedOpen.current !== null ? pressedOpen.current : opened !== null;
          pressedOpen.current = null;
          if (wasOpen) {
            setOpened(null);
          } else {
            open(event.currentTarget);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            if (opened === null) {
              open(event.currentTarget);
            }
          }
        }}
      >
        <Inside face={face} />
        <span className={styles.chevron}>
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {opened === null ? null : (
        <ScopePicker
          id={popupId}
          picker={picker}
          anchor={opened.anchor}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </>
  );
}

/**
 * The scope the page is read in: each face is a glyph, what it is (read, not drawn) and its value. A face is text, unless the host made it a control and gave it a picker (HM1): then it is a button that opens the list of what it
 * can say instead, with a chevron. Kit part it should become: ScopeLane.
 */
export function ScopeLane({ label, faces }: ScopeLaneProps) {
  if (faces === undefined || faces.length === 0) {
    return null;
  }

  return (
    <div className={styles.lane} role="group" aria-label={label} data-shell-part="lane">
      {faces.map((face) => {
        const { picker } = face;
        return picker === undefined ? (
          <span key={face.label} className={styles.face} data-shell-part="scopeFace" {...tip(face.text)}>
            <Inside face={face} />
          </span>
        ) : (
          <PickerFace key={face.label} face={face} picker={picker} />
        );
      })}
    </div>
  );
}
