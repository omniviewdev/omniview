import { Events } from '@omniviewdev/runtime/runtime';
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
    Events.On('plugin/process/log', (ev) => {
      pluginLogChannel.emit('onPluginLog', ev.data as PluginLogEntry);
    }),
  );

  return () => {
    cleanups.forEach((fn) => fn());
  };
}
