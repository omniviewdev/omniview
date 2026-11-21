import type { LogViewCopy, LogViewModel, LogViewState } from '../../log/logViewModel';
import type { LogTimestamps } from '../../log/types';

export type { LogViewCopy, LogViewState };

/**
 * The hands of a log view, for a toolbar that stands beside it (the mock's vertical toolbar: Follow, Pause, Clear, Copy). The toolbar makes one with `createLogViewControls`, gives it to the view
 * (`LogView`'s `controls`) and reads it as a store (`subscribe` and `getSnapshot`, the two functions `useSyncExternalStore` takes). It says little and says it rarely: the five facts of `LogViewState`, told
 * when one changes, never once a frame, so a toolbar is not drawn again for a line. Until a view is bound, and once it has gone, it says what it said last and does nothing when asked.
 */
export type LogViewControls = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LogViewState;
  /** `true`: back to the live end of the log, following it, and a paused feed is let through (the strip's Jump to latest). `false`: stop following where the list is. */
  readonly follow: (on: boolean) => void;
  /** `true`: the feed holds its reads (it goes on holding the lines it is sent, and the strip counts them). `false`: they come. The pause is the feed's: its own status says it, to every control that reads it. */
  readonly pause: (on: boolean) => void;
  /** The view forgets everything made so far, the lines the feed holds and the view had not read included (the mock's Clear empties its queue too); a paused feed stays paused. What the view had dropped is not told again, and what is dropped from now is. */
  readonly clear: () => void;
  /** What a Copy control writes: every line the list draws (the mock's Copy writes the lines of its view; the keyboard's copy is the selection's), the source of each included, in the clock `timestamps` names (the one the rows show). Undefined when the list draws no line. */
  readonly copy: (timestamps?: LogTimestamps) => LogViewCopy | undefined;
};

const NOT_BOUND: LogViewState = { following: true, drawn: false, held: false, paused: false, feed: 'starting' };

/** How the view that is given a control object attaches its model to it. Kept out of the object's own shape: it is the view's, never the toolbar's. */
const bindings = new WeakMap<LogViewControls, (model: LogViewModel) => () => void>();

/** Makes the controls of one log view: give them to the view and to the toolbar. */
export function createLogViewControls(): LogViewControls {
  let model: LogViewModel | undefined;
  let state = NOT_BOUND;
  const listeners = new Set<() => void>();
  const controls: LogViewControls = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    follow: (on) => {
      if (on) {
        model?.jumpToLatest();
      } else {
        model?.followOff();
      }
    },
    pause: (on) => {
      model?.setPaused(on);
    },
    clear: () => {
      model?.clear();
    },
    copy: (timestamps) => model?.copyLines(timestamps),
  };

  bindings.set(controls, (next) => {
    const read = () => {
      const now = next.getControls();
      if (now !== state) {
        state = now;
        for (const listener of [...listeners]) {
          listener();
        }
      }
    };

    model = next;
    read();
    const stop = next.subscribeControls(read);
    return () => {
      stop();
      if (model === next) {
        model = undefined;
      }
    };
  });
  return controls;
}

/** Binds a view's model to the controls it was given; returns what unbinds it. Controls that were not made by `createLogViewControls` are bound to nothing. For `LogView`; not part of the kit's surface. */
export function bindLogViewControls(controls: LogViewControls, model: LogViewModel): () => void {
  return bindings.get(controls)?.(model) ?? (() => undefined);
}
