import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionSource } from './sessionSource';
import { PrepareSessionEvents as prepareSessionSource, SubscribeSessionEvents } from '../../../../../../packages/omniviewdev-runtime/src/logSessionEvents';

const bus = vi.hoisted(() => ({ listeners: new Map<string, Set<(event: { data: unknown }) => void>>() }));
vi.mock('@wailsio/runtime', () => ({ Events: {
  On(key: string, listener: (event: { data: unknown }) => void) {
    const listeners = bus.listeners.get(key) ?? new Set();
    listeners.add(listener);
    bus.listeners.set(key, listeners);
    return () => listeners.delete(listener);
  },
  Off(key: string) { bus.listeners.delete(key); },
} }));
vi.mock('@omniviewdev/runtime/api', () => ({
  LogsClient: { SubscribeSessionEvents: (...args: Parameters<typeof SubscribeSessionEvents>) => SubscribeSessionEvents(...args) },
}));

function emit(key: string, data: unknown) {
  for (const listener of bus.listeners.get(key) ?? []) listener({ data });
}
const raw = (content: string) => ({ session_id: 'session', source_id: 'container', labels: {}, timestamp: '', content, origin: 0 });
const terminal = { type: 5, source_id: '', message: 'Complete', timestamp: '' };
const handlers = () => ({ onLines: vi.fn(), onEvent: vi.fn() });
const listenerCount = () => [...bus.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  bus.listeners.clear();
});

describe('SDK session event handoff', () => {
  it.each([terminal, { ...terminal, type: 2, message: 'Forbidden' }])('keeps early lines and event $type while creation remains unresolved', async event => {
    const release = prepareSessionSource('early');
    const creation = Promise.withResolvers<void>();
    const received = handlers();
    const mounted = creation.promise.then(() => createSessionSource('early').connect(received));
    emit('core/logs/lines/early', JSON.stringify([raw('first finite line')]));
    emit('core/logs/event/early', JSON.stringify(event));
    expect(received.onLines).not.toHaveBeenCalled();
    creation.resolve();
    const disconnect = await mounted;
    expect(received.onLines.mock.calls[0][0]).toMatchObject([{ content: 'first finite line' }]);
    expect(received.onEvent).toHaveBeenCalledExactlyOnceWith(event);
    emit('core/logs/lines/early', JSON.stringify([raw('second line')]));
    expect(received.onLines.mock.calls[1][0][0].lineNumber).toBe(2);
    disconnect();
    release();
    expect(listenerCount()).toBe(0);
  });

  it.each(['scalar', 'arguments', 'decoded'])('decodes %s Wails payloads', shape => {
    const received = handlers();
    const disconnect = createSessionSource('decode').connect(received);
    const wrap = (value: unknown) => shape === 'scalar' ? JSON.stringify(value) : shape === 'arguments' ? [JSON.stringify(value)] : value;
    emit('core/logs/lines/decode', wrap([raw('hello')]));
    emit('core/logs/event/decode', wrap(terminal));
    expect(received.onLines.mock.calls[0][0][0].content).toBe('hello');
    expect(received.onEvent).toHaveBeenCalledWith(terminal);
    disconnect();
  });

  it('disconnects only its own listeners', () => {
    const first = handlers();
    const second = handlers();
    const disconnectFirst = createSessionSource('shared').connect(first);
    const disconnectSecond = createSessionSource('shared').connect(second);
    disconnectFirst();
    emit('core/logs/lines/shared', JSON.stringify([raw('still subscribed')]));
    expect(first.onLines).not.toHaveBeenCalled();
    expect(second.onLines).toHaveBeenCalledOnce();
    disconnectSecond();
  });

  it('bounds pending lines and retains terminal events', () => {
    const release = prepareSessionSource('bounded');
    emit('core/logs/lines/bounded', JSON.stringify(Array.from({ length: 10005 }, (_, i) => raw(String(i)))));
    emit('core/logs/event/bounded', JSON.stringify(terminal));
    const received = handlers();
    const disconnect = createSessionSource('bounded').connect(received);
    const lines = received.onLines.mock.calls[0][0];
    expect(lines).toHaveLength(10000);
    expect(lines[0].content).toBe('5');
    expect(received.onEvent).toHaveBeenCalledWith(terminal);
    disconnect();
    release();
  });

  it('releases abandoned and failed create listeners', () => {
    prepareSessionSource('abandoned');
    const releaseFailed = prepareSessionSource('failed');
    releaseFailed();
    expect(listenerCount()).toBe(2);
    vi.advanceTimersByTime(60000);
    expect(listenerCount()).toBe(0);
    const received = handlers();
    const disconnect = createSessionSource('abandoned').connect(received);
    expect(received.onLines).not.toHaveBeenCalled();
    disconnect();
  });
});
