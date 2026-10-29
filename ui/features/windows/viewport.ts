import { WindowClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { currentWindow } from './identity';

let lastReportedViewportKey = '';

/**
 * Reports this window's viewport size to the Go WindowService. Go places the
 * viewport inside the native window bounds it tracks itself; webview screen
 * coordinates are not used because WebKitGTK reports them window-relative.
 */
function reportViewport(force: boolean): void {
  const viewportKey = `${window.innerWidth}x${window.innerHeight}`;
  if (!force && viewportKey === lastReportedViewportKey) {
    return;
  }

  lastReportedViewportKey = viewportKey;
  WindowClient.ReportViewport(currentWindow.name, window.innerWidth, window.innerHeight).catch((error: unknown) => {
    console.error('[windows] ReportViewport failed', error);
  });
}

/** Keeps the drag coordinator's view of this window's viewport size current. */
export function startViewportTracking(): () => void {
  const onResize = () => {
    reportViewport(false); 
  };

  window.addEventListener('resize', onResize);
  const offDragBegin = Events.On('windows/drag/begin', () => {
    reportViewport(true); 
  });
  reportViewport(true);
  return () => {
    window.removeEventListener('resize', onResize);
    offDragBegin();
  };
}
