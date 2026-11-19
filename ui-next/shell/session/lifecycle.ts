// When the page goes away or is hidden. The one file of the session module that names the browser: everything else is handed what it needs.

export type Lifecycle = {
  /** Calls the listener when the page is hidden or going away; returns the function that stops it. */
  readonly onHide: (listener: () => void) => () => void;
};

/**
 * The page's own lifecycle. `visibilitychange` to hidden covers a window that is minimised, covered by another app's, or hidden (the main window hides when it closes and the app keeps running,
 * so a quit that follows finds nothing left to write); `pagehide` covers a reload and a page that is torn down. Neither promises the write that starts then will finish, which is why the saver
 * writes after a quiet time of 400 ms and not only on these.
 */
export function browserLifecycle(): Lifecycle {
  return {
    onHide: (listener) => {
      const gone = () => {
        listener();
      };

      const hidden = () => {
        if (document.visibilityState === 'hidden') {
          listener();
        }
      };

      window.addEventListener('pagehide', gone);
      document.addEventListener('visibilitychange', hidden);
      return () => {
        window.removeEventListener('pagehide', gone);
        document.removeEventListener('visibilitychange', hidden);
      };
    },
  };
}
