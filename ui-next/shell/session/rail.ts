// The rail's choice: the plugin whose sidebar the window shows when the user chose it. It is the one thing the session saves that neither model holds, so it is a value the host sets and
// the session listens to, with the shape `useSyncExternalStore` takes (the models' stores have it too).

export type RailSource = {
  readonly getSnapshot: () => string | null;
  readonly subscribe: (listener: () => void) => () => void;
};

export type RailChoice = RailSource & {
  /** Tells the subscribers when the choice changed, and never when it did not. */
  readonly set: (id: string | null) => void;
};

export function createRailChoice(initial: string | null = null): RailChoice {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (id) => {
      if (id === current) {
        return;
      }

      current = id;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}
