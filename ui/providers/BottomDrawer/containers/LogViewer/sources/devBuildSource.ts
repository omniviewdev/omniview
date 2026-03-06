import { DevServerManager } from '@omniviewdev/runtime/api';
import { devToolsChannel } from '@/features/devtools/events';
import type { LogDataSource, LogEntry } from '../types';
import { parseAnsi } from '../utils/parseAnsi';

let lineCounter = 0;

function toLogEntry(raw: { timestamp: string; pluginID: string; source: string; level: string; message: string }): LogEntry {
  const parsed = parseAnsi(raw.message);
  return {
    lineNumber: ++lineCounter,
    sessionId: raw.pluginID,
    sourceId: raw.source,
    labels: { source: raw.source },
    timestamp: raw.timestamp,
    content: parsed.plain,
    origin: 'CURRENT',
    level: raw.level as LogEntry['level'],
    isJson: false,
    ansiSegments: parsed.segments.length > 0 ? parsed.segments : undefined,
  };
}

/**
 * Creates a LogDataSource for dev server build output.
 * Subscribes to build log events and loads historical logs from the ring buffer.
 */
export function createDevBuildSource(pluginId: string): LogDataSource {
  lineCounter = 0;

  return {
    connect(handlers) {
      const unsubLog = devToolsChannel.on('onBuildLog', (line) => {
        if (line.pluginID !== pluginId) return;
        handlers.onLines([toLogEntry(line)]);
      });

      return () => { unsubLog(); };
    },

    async loadHistory() {
      const entries = await DevServerManager.GetDevServerLogs(pluginId, 0);
      if (!entries?.length) return [];
      return entries.map(toLogEntry);
    },

    declaredDimensions: [
      { key: 'source', displayName: 'Sources' },
    ],
  };
}
