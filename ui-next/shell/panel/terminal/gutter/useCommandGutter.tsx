import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ScreenCommands } from '../screen';
import type { GutterCommand } from './commandGutter';
import { statusLine } from './words';
import styles from './GutterTip.module.css';

// The hover of a command's mark in the gutter, and what the gutter says (issue #694 step 5). The marks are the emulator's decorations (not elements of the page), so, as for a link in the same output, the tooltip is drawn at the
// mark from where the model says the pointer is, in the top layer, in one polite live region that exists only while it is shown. It covers output, so it can be put away without moving the pointer (WCAG 1.4.13, Content on Hover or
// Focus, "dismissible"): Escape hides it, a listener on the window in the capture phase that is there only while the tooltip is, and the key is neither stopped nor cancelled. It stays away for that mark until the pointer has left it.
//
// What an action did (a jump, a selection, a copy) is said to the body's live region, which every person who cannot see the view move hears; the hover is not said (the jump's words are the same facts).

export type CommandGutterScreen = { readonly commands: Pick<ScreenCommands, 'onEvent'> };

export type CommandGutterOptions = {
  readonly screen: CommandGutterScreen | undefined;
  /** Says words to a person who cannot see the view move: the body's polite live region. */
  readonly say: (words: string) => void;
};

export type CommandGutterView = {
  /** The tooltip of the mark the pointer is on, and nothing while it is on none. */
  readonly element: ReactNode;
};

type Hover = { readonly command: GutterCommand; readonly x: number; readonly y: number };

function Tip({ hover }: { readonly hover: Hover }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    try {
      element.current?.showPopover();
    } catch {
      // It is open already (a development build mounts an effect twice): nothing to do.
    }
  }, []);

  const { command } = hover;
  return (
    <div
      ref={element}
      role="tooltip"
      popover="manual"
      aria-live="polite"
      aria-atomic="true"
      className={styles.tip}
      style={{ '--_x': `${String(hover.x)}px`, '--_y': `${String(hover.y)}px` }}
    >
      {command.command === undefined || command.command === '' ? null : <div className={`${styles.line} ${styles.command}`}>{command.command}</div>}
      <div className={styles.line}>{statusLine(command)}</div>
      {command.cwd === undefined || command.cwd === '' ? null : <div className={`${styles.line} ${styles.muted}`}>{command.cwd}</div>}
    </div>
  );
}

export function useCommandGutter({ screen, say }: CommandGutterOptions): CommandGutterView {
  const [hover, setHover] = useState<Hover | undefined>(undefined);
  // The mark whose tooltip Escape put away, and whether the pointer has left it since: it stays away until it has.
  const dismissed = useRef<{ readonly id: string; left: boolean } | undefined>(undefined);
  const saying = useRef(say);
  useLayoutEffect(() => {
    saying.current = say;
  }, [say]);

  useEffect(() => {
    if (screen === undefined) {
      return undefined;
    }

    const stop = screen.commands.onEvent((event) => {
      if (event.kind === 'said') {
        saying.current(event.words);
        return;
      }

      const { command } = event;
      if (command === undefined) {
        setHover(undefined);
        if (dismissed.current !== undefined) {
          dismissed.current.left = true;
        }

        return;
      }

      const away = dismissed.current;
      if (away?.id === command.id && !away.left) {
        return;
      }

      dismissed.current = undefined;
      setHover({ command, x: event.x, y: event.y });
    });
    return () => {
      stop();
      dismissed.current = undefined;
      setHover(undefined);
    };
  }, [screen]);

  // Escape puts the tooltip away: only while one is shown, in the capture phase, and it neither stops the key nor cancels it.
  useEffect(() => {
    if (hover === undefined) {
      return undefined;
    }

    const putAway = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissed.current = { id: hover.command.id, left: false };
        setHover(undefined);
      }
    };

    window.addEventListener('keydown', putAway, true);
    return () => {
      window.removeEventListener('keydown', putAway, true);
    };
  }, [hover]);

  return { element: hover === undefined ? null : <Tip hover={hover} /> };
}
