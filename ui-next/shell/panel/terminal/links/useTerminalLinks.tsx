import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Platform } from '../../../core/chords';
import type { LinkHover, ResolvedFile } from '../engine';
import type { TerminalFeedHandle } from '../feed';
import type { TerminalScreen } from '../screen';
import type { TerminalSessions } from '../TerminalSessions';
import { followsWith, followWords, hostOf } from './links';
import styles from './LinkTip.module.css';

// The links in a terminal's output (T3a): a web address the emulator finds is a link the pointer can hover and click, and the host decides what a click does. VS Code and JetBrains ask for Command (Control elsewhere) with
// the click, so a plain click selects text as it always did, and say so in a tooltip when the pointer is on a link (the words are VS Code's, `links.ts`). The address opens outside the app, through the registry (`openExternal`), which
// is the window's own way to open one; a window that has none gets no link at all: a link that does nothing is not drawn, and its tooltip is never shown.
//
// The tooltip covers output, so it can be put away without moving the pointer (WCAG 1.4.13, Content on Hover or Focus, "dismissible"): Escape hides it, while it is shown and only then (a listener on the window, in the capture phase, added when
// the tooltip appears and removed when it goes), and the key is neither stopped nor cancelled: the terminal and the window get it as they always did. The tooltip stays away for that link until the pointer has left it. The emulator reports
// the pointer leaving a link and then the same link, in one task, when it reads a row again with the pointer where it was (output on the row, a link that wraps onto the next row), so a leave forgets the dismissal only when the link is not
// reported again before the task ends.

export type TerminalLinksScreen = Pick<TerminalScreen, 'setLinks'> & Partial<Pick<TerminalScreen, 'setFileLinks' | 'directoryAt' | 'fileCandidatesInView'>>;

export type TerminalLinksOptions = {
  /** The screen of the session. Before there is one (`undefined`) there are no links. */
  readonly screen: TerminalLinksScreen | undefined;
  readonly sessions: Pick<TerminalSessions, 'canOpenExternal' | 'canFollow' | 'openExternal'>;
  readonly platform: Platform;
  /** The file links (#696 step 4): what resolves a candidate and says what runs (the session's feed), and how a path is copied until the editor opens files. Absent: no file links (a terminal of a plugin has no disk of this machine to look at). */
  readonly files?: TerminalFileLinks | undefined;
};

export type TerminalFileLinks = {
  readonly feed: Pick<TerminalFeedHandle, 'resolveLink' | 'busy'>;
  /** Puts text on the clipboard: true when it did. */
  readonly copyPath: (text: string) => Promise<boolean>;
};

export type TerminalLinks = {
  /** The tooltip of the link the pointer is on, and nothing (no element, no node) while it is on none. Draw it anywhere in the body: it is a popover, and the window's. */
  readonly element: ReactNode;
  /** The file links in view, for the keyboard (`Open link` in the context menu): `warm` asks the host about the candidates of the lines in view, `inView` is what it found, as of the last `warm`. Absent: no file links. */
  readonly files?: { readonly inView: () => readonly ResolvedFile[]; readonly warm: () => Promise<void> } | undefined;
};

type LinkTipProps = {
  readonly x: number;
  readonly y: number;
  readonly words: string;
  /** Where the click goes: the address the link opens, whatever the words on the screen say (a hyperlink's text and target may differ). */
  readonly target: string;
};

/** Whether two reports are of one link: the emulator reports a link by its address and where its first cell is, so a pointer that moves along a link, or comes back to it, is on the same one. */
function sameLink(a: LinkHover | undefined, b: LinkHover | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }

  return a.uri === b.uri && a.x === b.x && a.y === b.y;
}

/** The link whose tooltip Escape put away, and whether the emulator has said since that the pointer left it (and has not said the link again). */
type Dismissed = {
  readonly link: LinkHover;
  left: boolean;
};

/**
 * The tooltip: in the top layer, at the link's first cell, in the one polite live region that exists only while it is shown, so that what a hover says to the eye is said to a person who cannot see it, once, as it comes. It is mounted
 * when the pointer reaches a link and unmounted when it leaves or Escape puts it away, so there is one for the whole time and nothing in the document otherwise; a move from one link to another moves it.
 */
function LinkTip({ x, y, words, target }: LinkTipProps) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    try {
      element.current?.showPopover();
    } catch {
      // It is open already (a development build mounts an effect twice): nothing to do.
    }
  }, []);

  return (
    <div
      ref={element}
      role="tooltip"
      popover="manual"
      aria-live="polite"
      aria-atomic="true"
      className={styles.tip}
      style={{ '--_x': `${String(x)}px`, '--_y': `${String(y)}px` }}
    >
      <span className={styles.words}>{words}</span>
      <span className={styles.host}>{hostOf(target)}</span>
      <span className={styles.target}>{target}</span>
    </div>
  );
}

export function useTerminalLinks({ screen, sessions, platform }: TerminalLinksOptions): TerminalLinks {
  // Links are made only where the window can open an address. The answer is the same every time.
  const linkable = sessions.canOpenExternal();
  const [hovered, setHovered] = useState<LinkHover | undefined>(undefined);
  // The tooltip that Escape put away: it does not come back for that link while the pointer stays on it.
  const dismissed = useRef<Dismissed | undefined>(undefined);
  // A click is read when it comes, from what the body holds then: the screen keeps one handler for as long as it is the same screen and the window can open addresses.
  const latest = useRef({ sessions, platform });
  useLayoutEffect(() => {
    latest.current = { sessions, platform };
  }, [sessions, platform]);

  useEffect(() => {
    if (screen === undefined || !linkable) {
      return undefined;
    }

    screen.setLinks({
      activate: (uri, event) => {
        // The emulator gives a click on a link as it came, with no key asked for: a plain click is a selection. An address the registry does not follow (not a web address, or the host's own server) is not followed whatever was held.
        const { sessions: current, platform: now } = latest.current;
        if (followsWith(event, now) && current.canFollow(uri)) {
          current.openExternal(uri);
        }
      },
      hover: (reported) => {
        // Only an address a click follows has a tooltip, which says that a click follows the link: a hyperlink the program writes (OSC 8) can name any scheme, where a printed address is a web address, and the host's own server is no link. Any other is no link here, as `activate` sees it.
        const next = reported !== undefined && latest.current.sessions.canFollow(reported.uri) ? reported : undefined;
        const away = dismissed.current;
        if (next === undefined) {
          setHovered(undefined);
          if (away !== undefined) {
            // The pointer left the link, unless the emulator says the link again before this task ends: it reports the two together when it reads the row again with the pointer where it was.
            away.left = true;
            queueMicrotask(() => {
              if (dismissed.current === away && away.left) {
                dismissed.current = undefined;
              }
            });
          }
        } else if (away !== undefined && sameLink(away.link, next)) {
          // The link that was put away, still under the pointer: it stays away.
          away.left = false;
        } else {
          dismissed.current = undefined;
          // The same link again keeps the tooltip it has: nothing is drawn again for it.
          setHovered((last) => (sameLink(last, next) ? last : next));
        }
      },
    });
    return () => {
      screen.setLinks(undefined);
      dismissed.current = undefined;
      setHovered(undefined);
    };
  }, [screen, linkable]);

  // Escape puts the tooltip away: a listener on the window, in the capture phase (the first place the key reaches the page), and only while a tooltip is shown. It neither stops the key nor cancels it.
  useEffect(() => {
    if (hovered === undefined) {
      return undefined;
    }

    const putAway = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissed.current = { link: hovered, left: false };
        setHovered(undefined);
      }
    };

    window.addEventListener('keydown', putAway, true);
    return () => {
      window.removeEventListener('keydown', putAway, true);
    };
  }, [hovered]);

  return { element: hovered === undefined ? null : <LinkTip x={hovered.x} y={hovered.y} words={followWords(platform)} target={hovered.uri} /> };
}
