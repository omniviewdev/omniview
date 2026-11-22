import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { platformOf } from '../../core/chords';
import type { Session } from '../../core/panel';
import { EmptyState } from '../EmptyState';
import { copyToClipboard } from '../logs/clipboard';
import { toggleChordText } from '../words';
import { readAppearance, SWATCH_ROLES } from './appearance';
import type { EngineLoader } from './engine';
import type { TerminalFeedHandle } from './feed';
import { loadXtermEngine } from './loadEngine';
import { createScreen } from './screen';
import { screenReaderWords, type ScreenReaderSource } from './screenReader';
import { laneOf } from './state';
import { TerminalToolbar } from './TerminalToolbar';
import type { TerminalSessions } from './TerminalSessions';
import { TERMINAL_GONE, TERMINAL_ICON } from './tool';
import styles from './TerminalBody.module.css';

// The body of a terminal session in the panel (docs/ui-next/status/T1.md, "The body"): the toolbar, the screen over its fixed status lane, and the words a person who cannot see them is told. The panel keeps
// every body mounted from the first time it is shown until its session closes, so what a body does while it is NOT on screen is decided here and in `screen.ts`: nothing. The emulator's state (its screen, its
// scrollback) stays; its listener on the feed, its frames, its observer and its GPU context are released while it is hidden, and the feed holds the output meanwhile, bound and counted.

/** How long Copy confirms itself with a check (the mock's `confirmCopy`, and the Logs toolbar's). */
const CONFIRM_MS = 2_000;

const COPY_FAILED = 'Couldn\'t copy. The clipboard isn\'t available here. Copy the selection with the keyboard.';

/** The theme's own attributes on the root: a change to any of them is a new look for the screen. */
const LOOK = ['data-ov-theme', 'data-ov-text-size', 'data-ov-density'];

const nothing = (): (() => void) => () => undefined;

/** Asks for a frame; returns what cancels it. */
const frameOf = (callback: () => void): (() => void) => {
  const id = requestAnimationFrame(callback);
  return () => {
    cancelAnimationFrame(id);
  };
};

/** Observes the size of an element: before paint, once a frame at most (the browser's own rule for a resize observer). Where there is no observer (a test), there is no size to follow. */
const observeSize = (element: HTMLElement, callback: () => void): (() => void) => {
  if (typeof ResizeObserver === 'undefined') {
    return nothing();
  }

  const observer = new ResizeObserver(callback);
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};

/** Resolves when the font is loaded; a font the page does not have (or a page with no font loading) resolves at once, and a font that is slow does not hold the terminal for more than a second and a half. */
const fontsReady = async (font: string): Promise<void> => {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (fonts === undefined) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fonts.load(font),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_500);
      }),
    ]);
  } catch {
    // A font that cannot load is the fallback's.
  } finally {
    clearTimeout(timer);
  }
};

/** The keyboard goes into a terminal the user started when it is not somewhere else: nowhere in particular (the page after a click), or in the panel (its `+`, its empty state's button, its tabs). */
function focusIsFree(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active.closest('[data-shell-region="panel"]') !== null;
}

type TerminalBodyProps = {
  /** Where the session's feed is held. */
  readonly sessions: TerminalSessions;
  readonly session: Session;
  /** The panel is open and this is the session on screen. */
  readonly visible: boolean;
  /** Where the emulator's code comes from: the lazy chunk by default; a test or a probe gives its own. */
  readonly load?: EngineLoader | undefined;
  /** The window's one screen reader choice (`screenReader.ts`): the emulator is made in it and follows it, and the description says which it is. */
  readonly screenReader: ScreenReaderSource;
};

/**
 * The body of a Terminal session. A session with no feed (restored from the last run: the host keeps no output across a restart) has nothing to draw: it says that the earlier output is gone and how to get a
 * shell again, in the empty state the panel has for it.
 */
export function TerminalBody({ sessions, session, visible, load, screenReader }: TerminalBodyProps) {
  const feed = sessions.feedOf(session.id);
  if (feed === undefined) {
    return <EmptyState icon={TERMINAL_ICON} title={TERMINAL_GONE.title} hint={TERMINAL_GONE.hint} />;
  }

  return <TerminalView sessions={sessions} session={session} feed={feed} visible={visible} load={load ?? loadXtermEngine} screenReader={screenReader} />;
}

type TerminalViewProps = {
  readonly sessions: TerminalSessions;
  readonly session: Session;
  readonly feed: TerminalFeedHandle;
  readonly visible: boolean;
  readonly load: EngineLoader;
  readonly screenReader: ScreenReaderSource;
};

function TerminalView({ sessions, session, feed, visible, load, screenReader }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const platform = platformOf(navigator);
  const label = session.scope === '' ? session.title : `${session.title} · ${session.scope}`;
  const [screen] = useState(() =>
    createScreen({
      feed,
      load,
      // The swatches are in the body, around the screen's element: found from it, so no ref is read while this renders.
      appearance: (element) => readAppearance(element.closest('[data-shell-part="terminalBody"]') ?? element),
      platform,
      label: `Terminal input, ${label}`,
      descriptionId: hintId,
      screenReader,
      frame: frameOf,
      observe: observeSize,
      fontsReady,
      copy: copyToClipboard,
    }),
  );
  const view = useSyncExternalStore(screen.subscribe, screen.getSnapshot);
  // The lane reads the feed's status: only while the body is on screen, so a hidden body holds no listener on the feed besides the registry's.
  const status = useSyncExternalStore(visible ? feed.subscribe : nothing, feed.getSnapshot);
  // The description says whether the output is read aloud: the same rule as the lane, so a hidden body holds no listener on the window's choice, and reads it again when it is shown.
  const reading = useSyncExternalStore(visible ? screenReader.subscribe : nothing, screenReader.getSnapshot);
  const [copies, setCopies] = useState(0);
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState<{ readonly id: number; readonly text: string } | undefined>(undefined);

  // The element the emulator draws in is this component's; the screen is gone with it (once), and so are the emulator and its listeners.
  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return undefined;
    }

    screen.mount(element);
    return () => {
      screen.dispose();
    };
  }, [screen]);

  // On screen or not: the screen shows itself the first time (it makes the emulator then), and lets go of everything while it is hidden.
  useEffect(() => {
    if (visible) {
      screen.show();
    } else {
      screen.hide();
    }
  }, [screen, visible]);

  // A new theme, a new text size or a new density is a new look: the root says so by its attributes, and the screen reads its swatches again.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      screen.refresh();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: LOOK });
    return () => {
      observer.disconnect();
    };
  }, [screen]);

  // The user started this session and wants to type in it (S116a): once its screen is there and its process is, the keyboard goes in, unless the person went somewhere else meanwhile.
  const running = status.state === 'running';
  useEffect(() => {
    if (!visible || !view.ready || !running || !sessions.takeFocus(session.id)) {
      return;
    }

    if (focusIsFree()) {
      screen.focus();
    }
  }, [screen, sessions, session.id, visible, view.ready, running]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCopied(false);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied, copies]);

  const say = (text: string) => {
    setAnnouncement((last) => ({ id: (last?.id ?? 0) + 1, text }));
  };

  const copy = () => {
    void screen.copy().then((done) => {
      if (done) {
        setCopied(true);
        setCopies((count) => count + 1);
        say('Selection copied');
      } else {
        say(COPY_FAILED);
      }
    });
  };

  const lane = view.error === undefined ? laneOf(status) : { words: 'The terminal view could not be loaded.', note: `${view.error}.` };
  const hint = `Escape and Tab go to the shell. Press F6 to move to the next part of the window${platform === 'mac' ? `, or ${toggleChordText(platform)} to hide the panel` : ''}. ${screenReaderWords(reading, platform)}`;

  return (
    <div className={styles.terminal} data-shell-part="terminalBody">
      <div className={styles.tools} data-shell-part="terminalTools">
        <TerminalToolbar
          selected={view.selected}
          copied={copied}
          onClear={() => {
            screen.clear();
          }}
          onCopy={copy}
        />
      </div>
      <div className={styles.main}>
        <div ref={host} className={styles.screen} data-shell-part="terminalScreen" />
        <div className={styles.lane} role="status" data-shell-part="terminalLane">
          {lane.words === '' ? null : (
            <>
              <span className={styles.laneWords}>{lane.words}</span>
              {lane.note === '' ? null : (
                <>
                  {' '}
                  <span className={styles.laneNote}>{lane.note}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <span id={hintId} className={styles.hint}>
        {hint}
      </span>
      <span key={announcement?.id} className={styles.live} aria-live="polite">
        {announcement?.text}
      </span>
      <div className={styles.swatches} aria-hidden="true">
        {SWATCH_ROLES.map((role) => (
          <span key={role} data-swatch={role} />
        ))}
        <span data-swatch="font" />
      </div>
    </div>
  );
}
