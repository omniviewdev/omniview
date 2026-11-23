import type { Platform } from '../../core/chords';
import { chordText } from '../../palette/words';

// The Terminal's screen reader mode (docs/ui-next/status/T1.md, section 16). The emulator draws its output where a screen reader does not look (its rows are `aria-hidden`, and so is the canvas of the GPU's renderer), and
// only its own `screenReaderMode` option puts the printed lines in the accessibility tree. The mode costs work on every line the emulator parses, so it is a person's choice and it is off until they make it. This is the one
// yes or no for the whole window: every terminal follows it (`screen.ts`), the session saves it (`shell/session`), and one palette command changes it (`plugins/host/palette.ts`). The words that find it are here too, so that
// the command a description names is the command the palette lists.

/** The palette command that turns the mode on and off, as the palette lists it and as the terminal's description names it: one string, so the two cannot disagree. */
export const SCREEN_READER_COMMAND = 'Terminal: Toggle Screen Reader Mode';

/** What a screen, a body or the session reads of the choice, in the shape `useSyncExternalStore` takes. */
export type ScreenReaderSource = {
  readonly getSnapshot: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
};

export type ScreenReaderChoice = ScreenReaderSource & {
  /** Tells the listeners when the choice changed, and never when it did not. */
  readonly set: (on: boolean) => void;
  /** Flips the choice and answers what it is now. */
  readonly toggle: () => boolean;
};

/** The window's choice, from what its session restored (off when it restored nothing). */
export function createScreenReaderChoice(initial = false): ScreenReaderChoice {
  let current = initial;
  const listeners = new Set<() => void>();
  const set = (on: boolean): void => {
    if (on === current) {
      return;
    }

    current = on;
    for (const listener of [...listeners]) {
      // A listener that left while the others were told is not told.
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
    toggle: () => {
      set(!current);
      return current;
    },
  };
}

/** What the window's live region says when the choice changed: one short sentence for each state. */
export const screenReaderSaid = (on: boolean): string => `Terminal screen reader mode ${on ? 'on' : 'off'}.`;

/**
 * What the terminal's description says of the mode, after the words about its keys: that the output is read aloud or is not, and how to change it. A person who cannot see the screen lands on the terminal's input and
 * hears this there, which is how they find the switch. It sends them OUT of the terminal first: inside it Command K clears the screen on a Mac and Control K is the shell's elsewhere, so the palette's chord is not
 * the palette's there.
 */
export function screenReaderWords(on: boolean, platform: Platform): string {
  const how = `leave the terminal with F6, open the command palette with ${chordText('Mod+K', platform)} and run ${SCREEN_READER_COMMAND}.`;
  return on ? `Screen reader mode is on: the output is read aloud. To turn it off, ${how}` : `The output is not read aloud until screen reader mode is on. To turn it on, ${how}`;
}
