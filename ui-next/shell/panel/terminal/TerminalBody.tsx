import { Button } from '@omniviewdev/kit';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { platformOf } from '../../core/chords';
import type { Session, SessionId } from '../../core/panel';
import { copyToClipboard } from '../logs/clipboard';
import { PanelEmpty } from '../PanelEmpty';
import { useMaybeRenaming } from '../renaming';
import { toggleChordText } from '../words';
import { readAppearance, SWATCH_ROLES } from './appearance';
import type { EngineLoader } from './engine';
import { offersTakeBack, type TerminalFeedHandle, type TerminalFeedSnapshot } from './feed';
import { createFindSession, useTerminalFind } from './find';
import { loadXtermEngine } from './loadEngine';
import { useTerminalLinks, useTerminalMenu } from './menu';
import { createScreen } from './screen';
import { screenReaderWords, type ScreenReaderSource } from './screenReader';
import { laneOf } from './state';
import { TerminalToolbar } from './TerminalToolbar';
import type { TerminalSessions } from './TerminalSessions';
import { TERMINAL_GONE, TERMINAL_ICON } from './tool';
import styles from './TerminalBody.module.css';

// The body of a terminal session in the panel (docs/ui-next/status/T1.md, "The body"): the toolbar, the screen over its fixed status lane, and the words a person who cannot see them is told. The panel keeps
// every body mounted from the first time it is shown until its session closes, so what a body does while it is NOT on screen is decided here and in `screen.ts`: it draws nothing, and it does not stop reading. The
// emulator's state (its screen, its scrollback) stays, and so does the screen's own listener on the feed: a hidden screen goes on reading, parsing and acknowledging what the process writes, in frames of a smaller share,
// so that a build in a session that is not shown is never stalled by the view (docs/ui-next/status/T2a.md). What is released while it is hidden is what only a screen on show needs: the lane's listener on the feed, the
// size observer and the measure, and the GPU context.
//
// The feed is the REGISTRY's, and the registry may change which feed a session has: it adopts a terminal that came back after a reload (the body of the saved tab can render before it did) and it swaps the feed for a fresh attach feed
// when the person takes a terminal back. The body reads it from the registry's own word of the change (`subscribeFeeds`) and makes a screen FOR A FEED: a new feed object for the same session is a new screen, the old one
// disposed with its emulator, and the new feed's replay applied on a fresh emulator as at a reload. A call of the registry in a render is not enough: the React Compiler keeps a call by what it is given (the registry and the id),
// and neither changes with the feed.

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

/** A number for each feed the body has made a screen for: a screen is for a feed, so a feed that comes after another is a new screen, whatever the session says. */
const feedKeys = new WeakMap<TerminalFeedHandle, number>();
let feedCount = 0;

function keyOfFeed(feed: TerminalFeedHandle): number {
  let key = feedKeys.get(feed);
  if (key === undefined) {
    feedCount += 1;
    key = feedCount;
    feedKeys.set(feed, key);
  }

  return key;
}

/**
 * Whether the lane offers to take the session's terminal back now: the registry can, and the tab that took it from this page has gone (`free`). While that tab lives there is no button: the tab that lost the terminal offers it
 * when the taker closes or detaches. The registry answers by the feed's status, so the status is an argument: the compiler keeps a call by what it is given, and a status that changed is a new object.
 */
function canTakeBack(sessions: TerminalSessions, id: SessionId, status: TerminalFeedSnapshot): boolean {
  return status.state === 'ended' && offersTakeBack(status.detached) && sessions.canTakeBack(id);
}

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
  /** The session as its tab names it, with the ordinal of a twin (`zsh (2)`: the panel's rule): the emulator's input is named by it. Absent, the title and the scope are. */
  readonly name?: string | undefined;
  /** Opens a new terminal where this session's terminal is (the menu's "New terminal here"): the window's own way to do it, which asks the session's feed where it is. Absent: the menu has no such item. */
  readonly onNewHere?: ((session: SessionId) => void) | undefined;
};

/**
 * The body of a Terminal session. A session with no feed (restored from the last run: the host keeps no output across a restart, or its terminal is not adopted yet) has nothing to draw: it says that the earlier output is gone
 * and how to get a shell again, in the empty state the panel has for it, and draws the screen when the registry gives it a feed.
 */
export function TerminalBody({ sessions, session, visible, load, screenReader, name, onNewHere }: TerminalBodyProps) {
  const feed = useSyncExternalStore(sessions.subscribeFeeds, () => sessions.feedOf(session.id));
  // The person pressed a control in the lane (Take it back) and wants the keyboard in the screen the registry makes for it: the request lives here, which that screen does not replace.
  const keyboard = useRef(false);
  if (feed === undefined) {
    return <PanelEmpty icon={TERMINAL_ICON} title={TERMINAL_GONE.title} hint={TERMINAL_GONE.hint} />;
  }

  const takeBack = () => {
    keyboard.current = true;
    // The registry says whether it gave the session another feed. A press that left the feed as it was leaves no new screen to take the keyboard, and the request must not wait for another feed that comes by itself.
    void sessions.takeBack(session.id).then((swapped) => {
      if (!swapped) {
        keyboard.current = false;
      }
    });
  };

  const takeKeyboard = () => {
    const asked = keyboard.current;
    keyboard.current = false;
    return asked;
  };

  return (
    <TerminalView
      key={keyOfFeed(feed)}
      sessions={sessions}
      session={session}
      feed={feed}
      visible={visible}
      load={load ?? loadXtermEngine}
      screenReader={screenReader}
      name={name}
      takeBack={takeBack}
      takeKeyboard={takeKeyboard}
      onNewHere={onNewHere}
    />
  );
}

type TerminalViewProps = {
  readonly sessions: TerminalSessions;
  readonly session: Session;
  readonly feed: TerminalFeedHandle;
  readonly visible: boolean;
  readonly load: EngineLoader;
  readonly screenReader: ScreenReaderSource;
  readonly name: string | undefined;
  /** The person pressed Take it back in the lane: asks the registry to take the terminal back, and keeps the request for the keyboard. */
  readonly takeBack: () => void;
  /** Whether the person pressed a control in the lane that asked for the keyboard, once: true the first time it is asked after the press. */
  readonly takeKeyboard: () => boolean;
  /** Opens a new terminal where this one is (the menu's "New terminal here"): the window's own way to do it. Absent: the menu has no such item. */
  readonly onNewHere: ((session: SessionId) => void) | undefined;
};

function TerminalView({ sessions, session, feed, visible, load, screenReader, name, takeBack, takeKeyboard, onNewHere }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const platform = platformOf(navigator);
  const label = name ?? (session.scope === '' ? session.title : `${session.title} · ${session.scope}`);
  // The find bar's session is made before the screen: the screen's keys (the find chord, F3, Escape) open the bar, step the find and close the bar through it, and `useTerminalFind` below draws the bar once the screen is there.
  const [finding] = useState(createFindSession);
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
      onFind: finding.open,
      onFindStep: finding.step,
      onFindClose: finding.closeIfOpen,
    }),
  );
  const view = useSyncExternalStore(screen.subscribe, screen.getSnapshot);
  const find = useTerminalFind({ screen, visible, ready: view.ready, session: finding });
  // The lane reads the feed's status only while the body is on screen: this listener is the lane's, and it is released while the body is hidden. The screen keeps its own (it goes on reading and acknowledging while hidden), besides the registry's.
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

  // On screen or not: the screen shows itself the first time (it makes the emulator then), and while it is hidden it lets go of what only a screen on show needs (the observer, the measure, the GPU context) and goes on reading the feed.
  useEffect(() => {
    if (visible) {
      screen.show();
    } else {
      screen.hide();
    }
  }, [screen, visible]);

  // The shell said its name and the tab was renamed: the emulator's input is named again, so that what a screen reader says for it is what the tab says.
  useEffect(() => {
    screen.rename(`Terminal input, ${label}`);
  }, [screen, label]);

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

  // The user started this session and wants to type in it (S116a), or pressed Take it back in the lane and wants to type in the terminal the registry made a screen for: once its screen is there and its process is, the
  // keyboard goes in, unless the person went somewhere else meanwhile. Both requests are spent when the keyboard is due, wherever it goes.
  const running = status.state === 'running';
  useEffect(() => {
    if (!visible || !view.ready || !running) {
      return;
    }

    const started = sessions.takeFocus(session.id);
    const pressed = takeKeyboard();
    if ((started || pressed) && focusIsFree()) {
      screen.focus();
    }
  }, [screen, sessions, session.id, visible, view.ready, running, takeKeyboard]);
  // The lane offers the way back for a terminal that this page lost and that nobody holds now.
  const takeable = canTakeBack(sessions, session.id, status);

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

  const renaming = useMaybeRenaming();
  const rename = () => {
    renaming?.request(session.id);
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

  // The context menu on the window's menu host and the links in the output (T3a): the screen's element carries the menu's trigger, Find is the bar's, and Copy is the toolbar's own copy, so it confirms itself the same way. A link's
  // tooltip is drawn where the pointer is on one, and the screen is given links only when the window can open an address.
  const here = onNewHere === undefined
    ? undefined
    : {
      open: () => {
        onNewHere(session.id);
      },
      available: feed.directory !== undefined,
    };
  const menu = useTerminalMenu({ screen, status, openFind: find.open, copy, here });
  const links = useTerminalLinks({ screen, sessions, platform });

  const lane = view.error === undefined ? laneOf(status) : { words: 'The terminal view could not be loaded.', note: `${view.error}.` };
  const hint = `Escape and Tab go to the shell. Press F6 to move to the next part of the window${platform === 'mac' ? `, or ${toggleChordText(platform)} to hide the panel` : ''}. ${screenReaderWords(reading, platform)}`;

  return (
    <div className={styles.terminal} data-shell-part="terminalBody">
      <div className={styles.tools} data-shell-part="terminalTools">
        <TerminalToolbar
          selected={view.selected}
          copied={copied}
          finding={find.isOpen}
          platform={platform}
          onFind={find.isOpen ? find.close : find.open}
          onClear={() => {
            screen.clear();
          }}
          onCopy={copy}
          onRename={renaming === null ? undefined : rename}
        />
      </div>
      <div className={styles.main}>
        <div ref={host} className={styles.screen} data-shell-part="terminalScreen" {...menu.host} />
        {find.element}
        {links.element}
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
          {takeable ? (
            <div className={styles.laneActions}>
              <Button size="row" data-shell-part="terminalTakeBack" onClick={takeBack}>
                Take it back
              </Button>
            </div>
          ) : null}
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
