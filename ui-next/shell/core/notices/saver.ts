import { createSaver, type Saver } from '../saver';
import type { PersistedNotices } from './types';

// The history, written one burst at a time: the saver is the shell's (../saver.ts); this says what a model saves. The document is the model's own `serialise()`, which leaves out what means "now"
// (a tick, a new phase, a toast), so work that runs makes no write, and the document is written only when something worth keeping changed.

export type { Saver };

export type NoticesSaverOptions = {
  readonly store: { readonly serialise: () => PersistedNotices; readonly subscribe: (listener: () => void) => () => void };
  /** Receives the document to save. */
  readonly write: (value: PersistedNotices) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export function createNoticesSaver(options: NoticesSaverOptions): Saver {
  return createSaver({
    store: { getSnapshot: () => options.store.serialise(), subscribe: options.store.subscribe },
    serialise: (saved: PersistedNotices) => saved,
    write: options.write,
    delay: options.delay,
  });
}
