import { serialise } from './persist';
import type { PersistedTabs, TabsState } from './types';

// One write per burst (docs/ui-next/optimisations.md HSH-25, MNR-K2). The old shell kept a pending write per slot and wrote the last value 400 ms after the last change, and flushed
// it when the window closed; the new one must, or the last tab state is lost. The saver owns nothing but a timer: what is written, and where, is the caller's.

export type SaverOptions = {
  readonly store: { readonly getSnapshot: () => TabsState; readonly subscribe: (listener: () => void) => () => void };
  /** Receives the document to save. */
  readonly write: (value: PersistedTabs) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export type Saver = {
  /** Writes what is pending at once (the window is closing). Nothing when nothing is pending. */
  readonly flush: () => void;
  /** Stops listening and drops what is pending: call `flush` first when that is wanted. */
  readonly dispose: () => void;
};

export function createSaver(options: SaverOptions): Saver {
  const delay = options.delay ?? 400;
  let last = JSON.stringify(serialise(options.store.getSnapshot()));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    timer = undefined;
    const saved = serialise(options.store.getSnapshot());
    const text = JSON.stringify(saved);
    if (text !== last) {
      last = text;
      options.write(saved);
    }
  };

  const unsubscribe = options.store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(write, delay);
  });

  return {
    flush: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        write();
      }
    },
    dispose: () => {
      unsubscribe();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
