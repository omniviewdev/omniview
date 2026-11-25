import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { platformOf } from '../../../core/chords';
import { FindBar } from './FindBar';
import { createFindSession, type FindScreen, type FindSession } from './findSession';

// The hook that draws the find bar over a terminal's screen and joins it to what it does (`findSession.ts`): the body renders `element` over the screen, and the toolbar's Find button and the screen's keys open, close and
// step the find through `open`, `close` and `step`. The bar is in the document only while it is open: while it is closed there is nothing drawn and nothing listening, and the screen is not asked for the emulator's search
// at all (it is a chunk the first opening loads).

export type TerminalFind = {
  /** Opens the bar and puts the keyboard in its field with the text in it selected; with the bar open, puts the keyboard in the field again. */
  readonly open: () => void;
  /** Closes the bar, clears the highlights and gives the keyboard back to the terminal. */
  readonly close: () => void;
  /** Closes the bar when it is open, as `close` does, and says so: true only when there was a bar to close. For the screen's Escape: the bar's while there is one, the shell's when there is none. */
  readonly closeIfOpen: () => boolean;
  /** Steps the find (F3, Shift F3, Command G). Says whether the bar took it: false while it is closed, so that the key is the terminal's. */
  readonly step: (direction: 'next' | 'previous') => boolean;
  readonly isOpen: boolean;
  /** The bar, or nothing while it is closed: for the body to draw over the screen. */
  readonly element: ReactNode;
};

export type UseTerminalFindOptions = {
  /** The screen the find is over: asked for its finder the first time the bar opens. */
  readonly screen: FindScreen | undefined;
  /** The body is on screen. A body that is not draws nothing, so it is told nothing: the bar is read again when it is shown. */
  readonly visible: boolean;
  /**
   * The screen's emulator is there (`ScreenSnapshot.ready`). The bar can be opened before it is (the panel is shown and the emulator's code is still loading), and the screen has no finder to give then: when the emulator is
   * there, a bar that is open searches what it holds, with no key pressed. A bar that is closed is not a reason to load the emulator's search. Absent, nothing is waited for.
   */
  readonly ready?: boolean | undefined;
  /**
   * The session to use, made before the screen so that the screen's own keys (`onFind`, `onFindStep`, `onFindClose`) can open the bar, step the find and close the bar through it. Absent, the hook makes its own: for a screen that
   * has no such keys, and for a test.
   */
  readonly session?: FindSession | undefined;
};

const nothing = (): (() => void) => () => undefined;

export function useTerminalFind({ screen, visible, ready, session }: UseTerminalFindOptions): TerminalFind {
  const [own] = useState(createFindSession);
  const found = session ?? own;
  const platform = platformOf(navigator);
  const root = useRef<HTMLDivElement>(null);
  /** The requests for the field that were served: the field takes the keyboard when there are more than this. */
  const served = useRef(0);
  // A body that is hidden draws nothing and is told nothing: the session goes on listening to the engine, so what it holds is right when the body is shown, and it is read again then.
  const state = useSyncExternalStore(visible ? found.subscribe : nothing, found.getSnapshot);

  // The session is over this screen for as long as the body has it. Unbinding closes an open bar and lets go of the finder: the screen goes with its emulator, and nothing is cleared in it.
  useEffect(() => {
    found.bind(screen);
    return () => {
      found.bind(undefined);
    };
  }, [found, screen]);

  // The emulator was made after the bar was opened: the session asks the screen again, and searches what the bar holds. The signal is the screen's own readiness, which the body already reads; no timer waits for it.
  useEffect(() => {
    if (ready === true) {
      found.screenReady();
    }
  }, [found, ready]);

  // Opening, and the chord pressed again with the bar open, ask for the keyboard for the field. A request made while the body was hidden is served when it is shown; one that was served is not served again, so a bar that is
  // only drawn again (a count that changed, a body that comes back) never takes the keyboard from where the person put it.
  useEffect(() => {
    if (!visible || state.focusRequests === served.current) {
      return;
    }

    served.current = state.focusRequests;
    if (state.isOpen) {
      const field = root.current?.querySelector('input');
      field?.focus();
      field?.select();
    }
  }, [visible, state.focusRequests, state.isOpen]);

  const element = state.isOpen ? (
    <FindBar
      ref={root}
      input={state.input}
      valid={state.valid}
      unavailable={state.unavailable}
      result={state.result}
      platform={platform}
      onQuery={found.setQuery}
      onToggle={found.toggle}
      onStep={found.step}
      onFind={found.open}
      onClose={found.close}
    />
  ) : null;

  return { open: found.open, close: found.close, closeIfOpen: found.closeIfOpen, step: found.step, isOpen: state.isOpen, element };
}
