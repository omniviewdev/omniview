import type { Finder, FindState } from '../engine';
import type { TerminalScreen } from '../screen';
import { canSearch, INITIAL_FIND, isValid, optionsOf, toggled, withQuery, type FindFlag, type FindInput } from './findModel';

// The behaviour behind the find bar, with no DOM (the view is `FindBar.tsx`, the words and the keys are `findModel.ts`): one session for a terminal's screen, a store the bar reads (`useSyncExternalStore`) and the screen's
// keys talk to. It holds what the bar holds (the text, the switches), whether it is open, and where the engine says the find stands; and it is the one place that talks to the engine's finder:
//   - the screen is asked for its finder when the bar is opened and not before (the emulator's search is a lazy chunk: a terminal nobody searches costs none of it): once while the answer is awaited, and again at every request
//     (typing, a switch, a step, opening again, the emulator being made) while the bar has none, whether the screen had none to give yet or failed; the finder is kept once it is had. A failure is said in the count lane
//     (`Unavailable`) until a request gets the finder;
//   - while the bar is open it listens to the finder, and each change of the text or a switch is a search (an incremental find: the match stays while the text is typed); a text that is empty, or a regular expression that
//     does not parse, is not searched: the highlights of the search before it are cleared instead, so a pattern the engine cannot read never reaches it;
//   - closing clears the highlights, lets the finder go and gives the keyboard back to the terminal; the text and the switches stay, and opening again looks for them again.

/** What the session needs of a screen: its finder, and the keyboard back. */
export type FindScreen = Pick<TerminalScreen, 'find' | 'focus'>;

export type FindSnapshot = {
  readonly isOpen: boolean;
  /** What the field and the switches hold. */
  readonly input: FindInput;
  /** Whether the text parses (`isValid`): a pattern that does not is never given to the engine. */
  readonly valid: boolean;
  /** Where the engine says the find stands for what is held, or nothing yet. Never the engine's word for an earlier text. */
  readonly result: FindState | undefined;
  /** How many times the field was asked to take the keyboard (each opening, and the chord pressed with the bar open): the view takes it when the number changes. */
  readonly focusRequests: number;
  /** The screen's finder could not be had (its load failed) and no request has got it since: the bar says so in its count lane. */
  readonly unavailable: boolean;
};

export type FindSession = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FindSnapshot;
  /** The screen the find is over: one screen, until it is bound to another or to nothing (which closes the bar). */
  readonly bind: (screen: FindScreen | undefined) => void;
  /** Opens the bar, or, when it is open, asks for the keyboard for the field again. Does nothing while there is no screen. */
  readonly open: () => void;
  /** Closes the bar: clears the highlights and gives the keyboard back to the terminal. Does nothing while it is closed. */
  readonly close: () => void;
  /** Closes the bar when it is open, as `close` does, and says so: true only when there was a bar to close. The Escape pressed in the terminal is the bar's while there is one, and the shell's when there is none. */
  readonly closeIfOpen: () => boolean;
  /** The screen's emulator is there now (it was not made when the bar was opened): a bar that is open and has no finder asks for it and searches what it holds, with no key pressed. A closed bar asks nothing. */
  readonly screenReady: () => void;
  /** Steps the find. Says whether the bar took the step: false while it is closed, so that the key is the terminal's. */
  readonly step: (direction: 'next' | 'previous') => boolean;
  readonly setQuery: (query: string) => void;
  readonly toggle: (flag: FindFlag) => void;
};

export type FindSessionOptions = {
  /** Where a finder that could not be had is said, once. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export function createFindSession(options: FindSessionOptions = {}): FindSession {
  const warn = options.warn ?? ((message: string, error?: unknown) => {
    console.warn(message, error);
  });
  const listeners = new Set<() => void>();
  let snapshot: FindSnapshot = { isOpen: false, input: INITIAL_FIND, valid: true, result: undefined, focusRequests: 0, unavailable: false };
  let screen: FindScreen | undefined;
  /** The screen's finder, once it has given it. */
  let finder: Finder | undefined;
  /** What stops the listening to the finder: held for as long as the bar is open and the finder is there. */
  let stopListening: (() => void) | undefined;
  /** The screen was asked for its finder and has not answered. */
  let asking = false;
  /** A failure was written to the console: the same failure is not written again by every request that meets it. */
  let warned = false;
  /** The screens bound so far: an answer for an earlier one is not for the screen the session has now. */
  let generation = 0;

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const listen = () => {
    if (finder === undefined || stopListening !== undefined || !snapshot.isOpen) {
      return;
    }

    stopListening = finder.onChange((result) => {
      snapshot = { ...snapshot, result };
      tell();
    });
  };

  const unlisten = () => {
    stopListening?.();
    stopListening = undefined;
  };

  /** Looks for what the bar holds, if there is something to look for: forward from the match the screen is on. */
  const search = (found: Finder, direction: 'next' | 'previous') => {
    const { input } = snapshot;
    if (!canSearch(input)) {
      return;
    }

    if (direction === 'next') {
      found.next(input.query, optionsOf(input));
    } else {
      found.previous(input.query, optionsOf(input));
    }
  };

  /**
   * Asks the screen for its finder: once while the answer is awaited, and again at every request while there is none, whether the screen had none to give yet (`undefined`: its emulator is not made) or failed (a load that did
   * not work may work the next time, and the words in the lane say so until one does). The finder is listened to, and the bar's text searched for, when it arrives and the bar is still open.
   */
  const ask = () => {
    if (screen === undefined || finder !== undefined || asking) {
      return;
    }

    const asked = screen;
    const turn = generation;
    asking = true;
    void asked.find().then(
      (found) => {
        if (turn !== generation) {
          return;
        }

        asking = false;
        if (found === undefined) {
          return;
        }

        finder = found;
        const recovered = snapshot.unavailable;
        if (recovered) {
          snapshot = { ...snapshot, unavailable: false };
        }

        listen();
        if (snapshot.isOpen) {
          search(found, 'next');
        }

        if (recovered) {
          tell();
        }
      },
      (error: unknown) => {
        if (turn !== generation) {
          return;
        }

        asking = false;
        // The bar says it in its count lane, and the console once: the same failure is not said again by every request that meets it.
        if (!warned) {
          warned = true;
          warn('The terminal\'s find could not be started.', error);
        }

        if (!snapshot.unavailable) {
          snapshot = { ...snapshot, unavailable: true };
          tell();
        }
      },
    );
  };

  /** The bar holds another text or another switch: the engine is told, unless there is nothing it can read. */
  const change = (input: FindInput) => {
    const searched = canSearch(snapshot.input);
    snapshot = { ...snapshot, input, valid: isValid(input), result: undefined };
    if (snapshot.isOpen) {
      if (finder === undefined) {
        ask();
      } else if (canSearch(input)) {
        search(finder, 'next');
      } else if (searched) {
        finder.clear();
      }
    }

    tell();
  };

  const open = () => {
    if (screen === undefined) {
      return;
    }

    const focusRequests = snapshot.focusRequests + 1;
    if (snapshot.isOpen) {
      snapshot = { ...snapshot, focusRequests };
      // The chord pressed again is a request like any other: a finder that could not be had is asked for again.
      ask();
      tell();
      return;
    }

    snapshot = { ...snapshot, isOpen: true, result: undefined, focusRequests };
    if (finder === undefined) {
      ask();
    } else {
      listen();
      search(finder, 'next');
    }

    tell();
  };

  const close = () => {
    if (!snapshot.isOpen) {
      return;
    }

    // The finder is let go of before it is cleared: it tells its listeners the empty state when it is, and the bar is closing, so it has nothing to say to it.
    unlisten();
    finder?.clear();
    snapshot = { ...snapshot, isOpen: false, result: undefined };
    // The keyboard goes back to the terminal while the field is still in the document, so that it never falls to the page when the field leaves.
    screen?.focus();
    tell();
  };

  const closeIfOpen = () => {
    if (!snapshot.isOpen) {
      return false;
    }

    close();
    return true;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    bind: (next) => {
      if (next === screen) {
        return;
      }

      generation += 1;
      // The old screen goes with its emulator, and what the finder highlights in it: nothing is cleared there.
      unlisten();
      finder = undefined;
      asking = false;
      screen = next;
      // What was said of the screen that failed was said of that screen.
      const cleared = snapshot.unavailable;
      if (cleared) {
        snapshot = { ...snapshot, unavailable: false };
      }

      if (!snapshot.isOpen) {
        if (cleared) {
          tell();
        }

        return;
      }

      if (next === undefined) {
        snapshot = { ...snapshot, isOpen: false, result: undefined };
      } else {
        snapshot = { ...snapshot, result: undefined };
        ask();
      }

      tell();
    },

    open,
    close,
    closeIfOpen,

    screenReady: () => {
      // A bar that is closed asks nothing: the emulator's search is not loaded for a bar nobody opened.
      if (snapshot.isOpen) {
        ask();
      }
    },

    step: (direction) => {
      if (!snapshot.isOpen) {
        return false;
      }

      if (finder === undefined) {
        ask();
      } else {
        search(finder, direction);
      }

      return true;
    },

    setQuery: (query) => {
      change(withQuery(snapshot.input, query));
    },

    toggle: (flag) => {
      change(toggled(snapshot.input, flag));
    },
  };
}
