import { SaveFileDialog, WriteFileContent } from '@omniviewdev/runtime/api';
import type { LogEntry } from '../types';

function formatAsText(entries: LogEntry[]): string {
  return entries.map((e) => {
    const ts = e.timestamp ? `[${e.timestamp}] ` : '';
    const src = e.sourceId ? `[${e.sourceId}] ` : '';
    return `${ts}${src}${e.content}`;
  }).join('\n');
}

function formatAsJson(entries: LogEntry[]): string {
  const data = entries.map((e) => ({
    timestamp: e.timestamp,
    source: e.sourceId,
    labels: e.labels,
    level: e.level,
    content: e.content,
  }));
  return JSON.stringify(data, null, 2);
}

/** Build a deterministic filename from the source IDs in the entries. */
function buildDefaultFilename(entries: LogEntry[], ext: string): string {
  const sources = new Set<string>();
  for (const e of entries) {
    if (e.sourceId) sources.add(e.sourceId);
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

  let name: string;
  const ids = [...sources];
  if (ids.length === 0) {
    name = `logs_${ts}`;
  } else if (ids.length <= 2) {
    name = ids.map(sanitize).join('_') + `_${ts}`;
  } else {
    name = ids.slice(0, 2).map(sanitize).join('_') + `_+${ids.length - 2}more_${ts}`;
  }

  return `${name}.${ext}`;
}

export async function saveLogsNative(entries: LogEntry[]): Promise<void> {
  const path = await SaveFileDialog({
    defaultFilename: buildDefaultFilename(entries, 'log'),
    title: 'Save Logs',
    canCreateDirectories: true,
    filters: [
      { displayName: 'Log Files (*.log)', pattern: '*.log' },
      { displayName: 'Text Files (*.txt)', pattern: '*.txt' },
      { displayName: 'JSON Files (*.json)', pattern: '*.json' },
    ],
  } as any);

  if (!path) return;

  const content = path.endsWith('.json') ? formatAsJson(entries) : formatAsText(entries);
  await WriteFileContent(path, content);
}

export function downloadAsText(entries: LogEntry[], filename?: string): void {
  downloadBlob(formatAsText(entries), filename ?? buildDefaultFilename(entries, 'log'), 'text/plain');
}

export function downloadAsJson(entries: LogEntry[], filename?: string): void {
  downloadBlob(formatAsJson(entries), filename ?? buildDefaultFilename(entries, 'json'), 'application/json');
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
