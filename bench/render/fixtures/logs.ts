/** Log stream fixtures delivered over the same Wails events the backend uses. */
import { emit } from '../harness/backend';
import { rng } from './kubernetes';

const START = Date.parse('2026-10-14T00:00:00Z');
const MESSAGES = [
  (r: () => number) => `GET /api/v1/orders/${Math.floor(r() * 1e6)} 200 ${Math.floor(r() * 300)}ms`,
  (r: () => number) => `{"level":"info","ts":"2026-10-14T00:00:00Z","msg":"processed batch","size":${Math.floor(r() * 500)},"queue":"orders"}`,
  (r: () => number) => `\u001b[33mWARN\u001b[0m slow query took ${Math.floor(r() * 2000)}ms: SELECT * FROM line_items WHERE order_id = $1`,
  () => `\u001b[32mINFO\u001b[0m health check ok`,
  (r: () => number) => `\u001b[31mERROR\u001b[0m upstream connect error or disconnect/reset before headers. retry=${Math.floor(r() * 5)}`,
  (r: () => number) => `cache miss key=user:${Math.floor(r() * 1e5)} fallback=db latency_ms=${(r() * 40).toFixed(2)}`,
];

export interface RawLogLine {
  session_id: string;
  source_id: string;
  labels: Record<string, string>;
  timestamp: string;
  content: string;
  origin: number;
}

/** `count` lines starting at line index `offset` (deterministic per index range). */
export function makeLogLines(sessionId: string, count: number, offset = 0, seed = 1): RawLogLine[] {
  const r = rng(seed + offset);
  const lines: RawLogLine[] = [];
  for (let i = 0; i < count; i++) {
    const n = offset + i;
    const pod = `api-7d9c8b${(n % 3).toString(16)}f5-x${n % 3}`;
    lines.push({
      session_id: sessionId,
      source_id: pod,
      labels: { pod, container: 'api' },
      timestamp: new Date(START + n * 37).toISOString(),
      content: `[#${n}] ${MESSAGES[Math.floor(r() * MESSAGES.length)](r)}`,
      origin: 1,
    });
  }
  return lines;
}

/** Push lines to a session the way the backend does: JSON-encoded batches on core/logs/lines/<id>. */
export function streamLines(sessionId: string, lines: RawLogLine[], batchSize = 100): void {
  for (let i = 0; i < lines.length; i += batchSize) {
    emit(`core/logs/lines/${sessionId}`, JSON.stringify(lines.slice(i, i + batchSize)));
  }
}

/** Text the viewer shows for line `n` (the marker every fixture line starts with). */
export const lineMarker = (n: number) => `[#${n}]`;
