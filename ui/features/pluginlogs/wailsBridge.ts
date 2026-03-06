import { EventsOn } from '@omniviewdev/runtime/runtime';
import { pluginLogChannel } from './events';
import type { PluginLogEntry } from './types';

/**
 * Initializes the bridge between Go-side Wails events and the
 * frontend plugin log event bus. Call once at app startup.
 * Returns a cleanup function that removes all listeners.
 */
export function initPluginLogBridge(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    EventsOn('plugin/process/log', (entry: PluginLogEntry) => {
      pluginLogChannel.emit('onPluginLog', entry);
    }),
  );

  return () => {
    cleanups.forEach((fn) => fn());
  };
}
