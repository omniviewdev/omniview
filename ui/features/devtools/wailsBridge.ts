import { Events } from '@omniviewdev/runtime/runtime';
import { DevServerManager } from '@omniviewdev/runtime/api';
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
    Events.On('plugin/devserver/status', (ev) => {
      devToolsChannel.emit('onStatusChange', ev.data as DevServerState);
    }),
  );

  cleanups.push(
    Events.On('plugin/devserver/log', (ev) => {
      const entries = ev.data as DevBuildLine[];
      for (const entry of entries) {
        devToolsChannel.emit('onBuildLog', entry);
      }
    }),
  );

  cleanups.push(
    Events.On('plugin/devserver/error', (ev) => {
      const [pluginId, errors] = ev.data as [string, DevBuildError[]];
      devToolsChannel.emit('onBuildError', { pluginId, errors });
    }),
  );

  // Wire outgoing events from the frontend to the backend.
  cleanups.push(
    devToolsChannel.on('onRestartDevServer', (pluginId: string) => {
      DevServerManager.RestartDevServer(pluginId);
    }),
  );

  cleanups.push(
    devToolsChannel.on('onRebuildPlugin', (pluginId: string) => {
      DevServerManager.RebuildPlugin(pluginId);
    }),
  );

  return () => {
    cleanups.forEach((fn) => fn());
  };
}
