import { useEffect, useMemo, type ReactNode } from 'react';
import { TabDragBrokerProvider } from '@omniviewdev/base-ui';
import { createWailsTabDragTransport } from './transport';
import { startViewportTracking } from './viewport';
import { flushPendingSlots } from './windowState';

/**
 * One tab drag broker per window, connected to every other window through the
 * Go WindowService. Page tab strips, pane strips and drawer strips inside this
 * provider can exchange tabs locally and across windows.
 */
export function WindowTabDragProvider({ children }: { children: ReactNode }) {
  const transport = useMemo(() => createWailsTabDragTransport(), []);

  useEffect(() => startViewportTracking(), []);

  useEffect(() => {
    window.addEventListener('beforeunload', flushPendingSlots);
    return () => {
      window.removeEventListener('beforeunload', flushPendingSlots); 
    };
  }, []);

  return <TabDragBrokerProvider transport={transport}>{children}</TabDragBrokerProvider>;
}
