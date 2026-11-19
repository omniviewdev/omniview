import { collapses, heightKey, limitsOf, resolveHeight, type PanelStore } from '../core/panel';

// The splitter's drag and keys (ch16 S99 to S102): the one resize primitive of the shell, for the panel's top edge. What it costs is the point (docs/ui-next/optimisations.md HLT-34, HLT-35,
// MNR-K3, MNR-X4, the old app's `ResizableSplitPane`):
//   - a pointer move writes no state and renders nothing: the position is recorded, and ONE animation-frame callback writes ONE style, the panel element's own `block-size`. Never a custom
//     property (it would restyle every descendant) and never the document root's (it restyles the whole page: the old drawer's cost was about 20 ms a toggle).
//   - nothing is measured per frame: the limits are read once, when the pointer goes down, and the size is arithmetic on the pointer.
//   - the model is committed once, on release; the inline size is given back to the stylesheet once React has drawn the committed size (`useSplitter`).
//   - Escape and a cancelled pointer put the size back as it was.
// Framework-free apart from the DOM it writes, so it is tested without React.

export type SplitterOptions = {
  readonly store: PanelStore;
  /** The panel element: the one thing a drag writes to. */
  readonly panel: () => HTMLElement | null;
  /** The window's height in pixels, read once per gesture. */
  readonly viewport?: (() => number) | undefined;
  /** Called once a release has hidden the panel (a drag that ended below the collapse threshold), while the separator that was pressed is still drawn. */
  readonly onCollapse?: (() => void) | undefined;
};

/** What the handle's element listens to. A pointer event of the DOM or of React: only these members are read. */
export type PointerLike = {
  readonly button: number;
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly clientY: number;
  readonly currentTarget: { setPointerCapture?: ((id: number) => void) | undefined };
};

export type KeyLike = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean | undefined;
  readonly preventDefault: () => void;
};

export type Splitter = {
  readonly pointerDown: (event: PointerLike) => void;
  readonly pointerMove: (event: Pick<PointerLike, 'pointerId' | 'clientY'>) => void;
  readonly pointerUp: (event: Pick<PointerLike, 'pointerId' | 'clientY'>) => void;
  /** The pointer was cancelled or capture was lost: the drag ends as it was. */
  readonly cancel: () => void;
  readonly key: (event: KeyLike) => void;
  readonly reset: () => void;
  /** Whether a drag is running: while it is, the inline size is the drag's. */
  readonly dragging: () => boolean;
  /** Hands the size back to the stylesheet: removes the inline size a drag wrote, unless a drag is running (the inline size is the drag's then). */
  readonly release: () => void;
  /** Ends a drag that is still running, as a cancel, and drops the listener it holds. */
  readonly dispose: () => void;
};

type Drag = {
  readonly pointerId: number;
  readonly start: number;
  readonly size: number;
  readonly min: number;
  readonly max: number;
  raw: number;
  applied: number;
  dirty: boolean;
  frame: number;
};

/** The element the drag's attribute is written on: the shell's window, found from the panel. Never `<html>`, where an attribute restyles the page. */
const windowOf = (panel: HTMLElement): HTMLElement | null => panel.closest<HTMLElement>('[data-shell-part="window"]');

export function createSplitter({ store, panel, viewport = () => window.innerHeight, onCollapse }: SplitterOptions): Splitter {
  let drag: Drag | null = null;

  const clamp = (session: Drag, size: number) => Math.min(session.max, Math.max(session.min, size));

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && drag !== null) {
      event.preventDefault();
      event.stopPropagation();
      end(false, undefined);
    }
  };

  const write = (session: Drag): void => {
    session.frame = 0;
    if (!session.dirty) {
      return;
    }

    session.dirty = false;
    const size = clamp(session, session.raw);
    const element = panel();
    if (element !== null && size !== session.applied) {
      session.applied = size;
      element.style.blockSize = `${String(size)}px`;
    }
  };

  function end(commit: boolean, raw: number | undefined): void {
    const session = drag;
    if (session === null) {
      return;
    }

    drag = null;
    cancelAnimationFrame(session.frame);
    window.removeEventListener('keydown', onEscape, true);
    const element = panel();
    if (element !== null) {
      windowOf(element)?.removeAttribute('data-resizing');
    }

    const final = raw ?? session.raw;
    // The window may have changed height while the pointer was down: the size committed is within the limits of the window it is released in, not of the one the drag began in.
    const now = limitsOf(viewport());
    const collapsing = commit && final !== session.size && collapses(final);
    const answer = commit && final !== session.size ? (collapsing ? store.resize({ collapse: true }) : store.resize({ size: Math.min(now.max, Math.max(now.min, final)) })) : undefined;
    if (collapsing && answer?.status === 'done') {
      onCollapse?.();
    }

    // A commit that changed the model is drawn by React in a moment, and `useSplitter` hands the size back then; any other end gives it back here.
    if (element !== null && answer?.status !== 'done') {
      element.style.blockSize = '';
    }
  }

  return {
    pointerDown: (event) => {
      const element = panel();
      if (drag !== null || event.button !== 0 || !event.isPrimary || element === null) {
        return;
      }

      const height = viewport();
      const { min, max } = limitsOf(height);
      const size = resolveHeight(store.getSnapshot().height, height);
      drag = { pointerId: event.pointerId, start: event.clientY, size, min, max, raw: size, applied: size, dirty: false, frame: 0 };
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A synthetic pointer cannot be captured: the drag still follows the events it gets.
      }

      windowOf(element)?.setAttribute('data-resizing', 'y');
      window.addEventListener('keydown', onEscape, true);
    },
    pointerMove: (event) => {
      const session = drag;
      if (session?.pointerId !== event.pointerId) {
        return;
      }

      // The handle is the panel's top edge: moving the pointer up grows the panel.
      session.raw = session.size + (session.start - event.clientY);
      session.dirty = true;
      if (session.frame === 0) {
        session.frame = requestAnimationFrame(() => {
          write(session);
        });
      }
    },
    pointerUp: (event) => {
      const session = drag;
      if (session !== null && event.pointerId === session.pointerId) {
        end(true, session.size + (session.start - event.clientY));
      }
    },
    cancel: () => {
      end(false, undefined);
    },
    key: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing === true || drag !== null) {
        return;
      }

      const height = viewport();
      const answer = heightKey(resolveHeight(store.getSnapshot().height, height), height, event.key, event.shiftKey);
      if (answer === undefined) {
        return;
      }

      event.preventDefault();
      if ('reset' in answer) {
        store.resetHeight();
      } else {
        store.resize({ size: answer.size });
      }
    },
    reset: () => {
      store.resetHeight();
    },
    dragging: () => drag !== null,
    release: () => {
      const element = panel();
      if (drag === null && element !== null) {
        element.style.blockSize = '';
      }
    },
    dispose: () => {
      end(false, undefined);
    },
  };
}
