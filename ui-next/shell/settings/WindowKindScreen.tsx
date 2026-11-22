import { Suspense, useEffect, useState, type ReactNode } from 'react';
import type { WindowKind } from './windowKind';

export type WindowKindScreenProps = {
  /** Whether the app has native windows. A browser has none: its page is the shell, at once. */
  readonly native: boolean;
  /** Which kind of window this page is in (`resolveWindowKind`). Called once, and only in a native window. */
  readonly resolve: () => Promise<WindowKind>;
  /** What the Settings window draws, and nothing else: no shell around it. */
  readonly settings: ReactNode;
  /** What every other window draws: the shell. */
  readonly children: ReactNode;
};

/**
 * What the window draws is decided by its kind (the host's window service: the app's Settings is a window of kind `settings`, 1060 x 640 px, and the new UI draws its content there, with no shell around it). In a browser there is
 * no such window and the shell is drawn at once, with no wait; in a native window the page asks which it is and draws nothing until the host has answered (the shell's own first frame waits for the same window service's answer
 * about its session, so this adds no wait of its own that the shell was not already in). A window that cannot be told what it is draws the shell.
 */
export function WindowKindScreen({ native, resolve, settings, children }: WindowKindScreenProps) {
  const [kind, setKind] = useState<WindowKind | undefined>(native ? undefined : 'other');
  useEffect(() => {
    if (!native) {
      return;
    }

    let current = true;
    void resolve().then((resolved) => {
      if (current) {
        setKind(resolved);
      }
    });
    return () => {
      current = false;
    };
  }, [native, resolve]);

  if (kind === undefined) {
    return null;
  }

  return kind === 'settings' ? <Suspense fallback={null}>{settings}</Suspense> : <>{children}</>;
}
