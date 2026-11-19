// One write per burst (docs/ui-next/optimisations.md HSH-25, HLT-36, MNR-K2). The old shell kept a pending write per slot and wrote the last value 400 ms after the last change, and flushed it
// when the window closed; the new one must, or the last state is lost. The saver owns nothing but a timer and what is owed: what is written, and where, is the caller's. The tab model and the
// panel model each save their session through it. A document is recorded as saved only once `write` has returned: when it throws, the document stays owed, the failure goes to whoever was
// running the write (the timer's callback, so the host's error report, or the caller of `flush`), and the next change or `flush` writes it again. It does not retry by itself: a place that
// stays full would be asked in a loop.

export type SaverOptions<State, Document> = {
  readonly store: { readonly getSnapshot: () => State; readonly subscribe: (listener: () => void) => () => void };
  /** What a state saves of itself. */
  readonly serialise: (state: State) => Document;
  /** Receives the document to save. */
  readonly write: (value: Document) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export type Saver = {
  /** Writes what is owed at once (the window is closing), the document of a write that failed included. Nothing when nothing is owed. */
  readonly flush: () => void;
  /** Stops listening and drops what is pending: call `flush` first when that is wanted. */
  readonly dispose: () => void;
};

export function createSaver<State, Document>(options: SaverOptions<State, Document>): Saver {
  const delay = options.delay ?? 400;
  let last = JSON.stringify(options.serialise(options.store.getSnapshot()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A change was seen that no write has recorded yet. It outlives the timer, which is why a write that failed after the timer ran is still flushed. */
  let owed = false;

  const write = () => {
    timer = undefined;
    const saved = options.serialise(options.store.getSnapshot());
    const text = JSON.stringify(saved);
    // A write may publish to the store it saves (a change the next write must carry): the debt is cleared before it, so that change is owed again by the time the write returns, and put back when the write refuses.
    owed = false;
    if (text !== last) {
      try {
        options.write(saved);
      } catch (error) {
        owed = true;
        throw error;
      }

      last = text;
    }
  };

  const unsubscribe = options.store.subscribe(() => {
    owed = true;
    clearTimeout(timer);
    timer = setTimeout(write, delay);
  });

  return {
    flush: () => {
      if (owed) {
        clearTimeout(timer);
        write();
      }
    },
    dispose: () => {
      unsubscribe();
      owed = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
