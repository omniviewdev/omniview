import type { LogEntry } from '../types';

export function downloadAsText(entries: LogEntry[], filename = 'logs.log'): void {
  const lines = entries.map((e) => {
    const ts = e.timestamp ? `[${e.timestamp}] ` : '';
    const src = e.sourceId ? `[${e.sourceId}] ` : '';
    return `${ts}${src}${e.content}`;
  });
  downloadBlob(lines.join('\n'), filename, 'text/plain');
}

export function downloadAsJson(entries: LogEntry[], filename = 'logs.json'): void {
  const data = entries.map((e) => ({
    timestamp: e.timestamp,
    source: e.sourceId,
    labels: e.labels,
    level: e.level,
    content: e.content,
  }));
  downloadBlob(JSON.stringify(data, null, 2), filename, 'application/json');
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
