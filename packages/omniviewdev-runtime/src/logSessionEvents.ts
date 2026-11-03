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
  try {
    const events = Events.On(`core/logs/event/${sessionId}`, ev => handlers.onEvent(ev.data));
    return () => { lines(); events(); };
  } catch (error) {
    lines();
    throw error;
  }
}

/** Capture output during creation; expire unclaimed output only after successful settlement. */
export function PrepareSessionEvents(sessionId: string) {
  if (pending.has(sessionId)) throw new Error('Log session ID is already in use.');
  const lines: unknown[] = [];
  const events: { data: unknown; order: number }[] = [];
  // Retain latest state for each SDK event type (0–6), independently of source bursts.
  const lifecycle = new Map<number, { data: unknown; order: number }>();
  let order = 0;
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
        const event = decode(data);
        const entry = { data: event, order: order++ };
        if (event && typeof event === 'object' && 'source_id' in event && event.source_id === ''
          && 'type' in event && typeof event.type === 'number' && Number.isInteger(event.type)
          && event.type >= 0 && event.type <= 6) {
          lifecycle.set(event.type, entry);
        } else {
          events.push(entry);
          if (events.length > MAX_PENDING_EVENTS) events.shift();
        }
      } catch (error) { console.error('Failed to parse log event:', error); }
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    clearTimeout(timer);
    disconnect();
    if (pending.get(sessionId) === handoff) pending.delete(sessionId);
    lines.length = 0;
    events.length = 0;
    lifecycle.clear();
  };
  const settled = () => {
    if (pending.get(sessionId) === handoff) timer ??= setTimeout(release, 60000);
  };
  const handoff = {
    connect(handlers: LogEventHandlers) {
      const backlogLines = lines.splice(0);
      const backlogEvents = [...events, ...lifecycle.values()].sort((a, b) => a.order - b.order);
      release();
      const cleanup = subscribe(sessionId, handlers);
      try {
        if (backlogLines.length) handlers.onLines(backlogLines);
        for (const event of backlogEvents) handlers.onEvent(event.data);
        return cleanup;
      } catch (error) {
        cleanup();
        throw error;
      }
    },
  };
  pending.set(sessionId, handoff);
  return { release, settled };
}

/** Subscribe to an SDK session and adopt any output captured during creation. */
export function SubscribeSessionEvents(sessionId: string, handlers: LogEventHandlers) {
  return pending.get(sessionId)?.connect(handlers) ?? subscribe(sessionId, handlers);
}
