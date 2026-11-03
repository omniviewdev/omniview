import { Events } from '@wailsio/runtime';

type LogEventHandlers = { onLines: (data: unknown) => void; onEvent: (data: unknown) => void };
const pending = new Map<string, { connect: (handlers: LogEventHandlers) => () => void }>();
const MAX_PENDING_LINES = 10000;
const MAX_PENDING_EVENTS = 100;

/** Normalize scalar and emit-argument-array Wails payloads. */
function decode(data: unknown): unknown {
  const value = Array.isArray(data) && data.length === 1 && typeof data[0] === 'string' ? data[0] : data;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function subscribe(sessionId: string, handlers: LogEventHandlers) {
  const lines = Events.On(`core/logs/lines/${sessionId}`, ev => handlers.onLines(ev.data));
  const events = Events.On(`core/logs/event/${sessionId}`, ev => handlers.onEvent(ev.data));
  return () => { lines(); events(); };
}

/** Capture output before creation resolves; release failed or abandoned handoffs. */
export function PrepareSessionEvents(sessionId: string) {
  if (pending.has(sessionId)) throw new Error('Log session ID is already in use.');
  const lines: unknown[] = [];
  const events: unknown[] = [];
  const disconnect = subscribe(sessionId, {
    onLines(data) {
      try {
        const batch = decode(data);
        if (!Array.isArray(batch)) return;
        lines.push(...batch.slice(-MAX_PENDING_LINES));
        if (lines.length > MAX_PENDING_LINES) lines.splice(0, lines.length - MAX_PENDING_LINES);
      } catch (error) { console.error('Failed to parse log lines:', error); }
    },
    onEvent(data) {
      try {
        events.push(decode(data));
        if (events.length > MAX_PENDING_EVENTS) events.shift();
      } catch (error) { console.error('Failed to parse log event:', error); }
    },
  });
  let timer: ReturnType<typeof setTimeout>;
  const release = () => {
    clearTimeout(timer);
    disconnect();
    if (pending.get(sessionId) === handoff) pending.delete(sessionId);
    lines.length = 0;
    events.length = 0;
  };
  const handoff = {
    connect(handlers: LogEventHandlers) {
      const backlogLines = lines.splice(0);
      const backlogEvents = events.splice(0);
      release();
      const cleanup = subscribe(sessionId, handlers);
      if (backlogLines.length) handlers.onLines(backlogLines);
      for (const event of backlogEvents) handlers.onEvent(event);
      return cleanup;
    },
  };
  pending.set(sessionId, handoff);
  timer = setTimeout(release, 60000);
  return release;
}

/** Subscribe to an SDK session and adopt any output captured during creation. */
export function SubscribeSessionEvents(sessionId: string, handlers: LogEventHandlers) {
  return pending.get(sessionId)?.connect(handlers) ?? subscribe(sessionId, handlers);
}
