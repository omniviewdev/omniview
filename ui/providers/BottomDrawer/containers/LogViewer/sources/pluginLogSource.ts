import { PluginLogManager } from '@omniviewdev/runtime/api';
import { pluginLogChannel } from '@/features/pluginlogs/events';
import type { LogDataSource, LogEntry } from '../types';
import { parseAnsi } from '../utils/parseAnsi';

let lineCounter = 0;

function toLogEntry(raw: { timestamp: string; pluginID: string; source: string; level: string; message: string }): LogEntry {
  const parsed = parseAnsi(raw.message);
  return {
    lineNumber: ++lineCounter,
    sessionId: raw.pluginID,
    sourceId: raw.source || 'plugin',
    labels: { level: raw.level, source: raw.source || 'plugin' },
    timestamp: raw.timestamp,
    content: parsed.plain,
    origin: 'CURRENT',
    level: raw.level as LogEntry['level'],
    isJson: false,
    ansiSegments: parsed.segments.length > 0 ? parsed.segments : undefined,
  };
}

/**
 * Creates a LogDataSource for plugin process logs.
 * Subscribes to the backend log ring buffer and real-time events.
 */
export function createPluginLogSource(pluginId: string): LogDataSource {
  lineCounter = 0;

  return {
    connect(handlers) {
      PluginLogManager.Subscribe(pluginId);

      const unsub = pluginLogChannel.on('onPluginLog', (entry) => {
        if (entry.pluginID !== pluginId) return;
        handlers.onLines([toLogEntry(entry)]);
      });

      return () => {
        unsub();
        PluginLogManager.Unsubscribe(pluginId);
      };
    },

    async loadHistory() {
      const entries = await PluginLogManager.GetLogs(pluginId, 0);
      if (!entries?.length) return [];
      return entries.map(toLogEntry);
    },

    declaredDimensions: [
      { key: 'level', displayName: 'Levels' },
      { key: 'source', displayName: 'Sources' },
    ],
  };
}
