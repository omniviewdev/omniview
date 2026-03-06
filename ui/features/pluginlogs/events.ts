import { eventbus } from '@/events/eventbus';
import type { PluginLogEntry } from './types';

type PluginLogEvents = {
  /** Fired when a plugin process log entry is received (only for subscribed plugins). */
  onPluginLog: (entry: PluginLogEntry) => void;

  /** Fired when user requests to open the process log viewer for a plugin. */
  onOpenPluginLogs: (pluginId: string) => void;
};

export const pluginLogChannel = eventbus<PluginLogEvents>();
