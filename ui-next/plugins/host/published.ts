// What a mounted page or sidebar tells the frame around it, kept where the frame can read it. A plugin's data hook runs in the page's own component (one data hook per page,
// docs/ui-next/optimisations.md MNR-T8), so the frame (the scope lane, the sidebar's entries) and the tab's description cannot be a function of anything but what the hook returned:
// the component publishes it here, in a layout effect, and whoever draws the frame subscribes. Framework-free, like `pluginStore.ts`: React reads it through `useSyncExternalStore`.
//
// A published value stays when its publisher stops (a hidden page releases its effects, and the frame of the tab that is on screen is the one that matters), and a value equal to the one
// held changes nothing and tells nobody, so a hook that builds a new object on every render does not loop the frame.

export class Published<T> {
  private readonly values = new Map<string, { readonly value: T; readonly text: string }>();
  private readonly listeners = new Set<() => void>();

  /** The value held for `key`. The same object until it is replaced by a different one. */
  get = (key: string): T | undefined => this.values.get(key)?.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Holds `value` for `key`. Answers whether it changed anything. Plain data only: equality is by content. */
  publish(key: string, value: T): boolean {
    const text = JSON.stringify(value);
    if (this.values.get(key)?.text === text) {
      return false;
    }

    this.values.set(key, { value, text });
    for (const listener of [...this.listeners]) {
      listener();
    }

    return true;
  }
}
