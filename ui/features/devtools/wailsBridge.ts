import { EventsOn } from '@omniviewdev/runtime/runtime';
import { devToolsChannel } from './events';
import type { DevServerState, DevBuildLine, DevBuildError } from './types';

/**
 * Initializes the bridge between Go-side Wails events and the
 * frontend dev tools event bus. Call once at app startup.
 * Returns a cleanup function that removes all listeners.
 */
export function initDevToolsBridge(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    EventsOn('plugin/devserver/status', (state: DevServerState) => {
      devToolsChannel.emit('onStatusChange', state);
    }),
  );

  cleanups.push(
    EventsOn('plugin/devserver/log', (entries: DevBuildLine[]) => {
      for (const entry of entries) {
        devToolsChannel.emit('onBuildLog', entry);
      }
    }),
  );

  cleanups.push(
    EventsOn('plugin/devserver/error', (pluginId: string, errors: DevBuildError[]) => {
      devToolsChannel.emit('onBuildError', { pluginId, errors });
    }),
  );

  return () => {
    cleanups.forEach((fn) => fn());
  };
}
