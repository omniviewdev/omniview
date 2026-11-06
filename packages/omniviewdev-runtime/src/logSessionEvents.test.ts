import { afterEach, expect, it, vi } from 'vitest';
import { CreateSession, SubscribeSessionEvents } from './logs';
import type { LogSessionRequest } from './logs';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { Events } from '@wailsio/runtime';
import { PrepareSessionEvents } from './logSessionEvents';

const transport = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  call: vi.fn(),
}));
vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: (...args: unknown[]) => transport.call(...args) },
  Create: { Any: (value: unknown) => value, Nullable: (fn: unknown) => fn, Map: (_key: unknown, fn: unknown) => fn, Array: (fn: unknown) => fn },
  Events: {
    On(key: string, listener: (event: { data: unknown }) => void) {
      const listeners = transport.listeners.get(key) ?? new Set();
      listeners.add(listener);
      transport.listeners.set(key, listeners);
      return () => listeners.delete(listener);
    },
  },
}));
afterEach(() => { transport.listeners.clear(); vi.clearAllMocks(); vi.useRealTimers(); });
const options: LogSessionRequest = {
  resource_key: 'pods', resource_id: 'pod',
  options: { target: '', follow: false, include_previous: false, include_timestamps: true, tail_lines: 10, since_seconds: 0, limit_bytes: 0, include_source_events: true, params: {} },
};

it('subscribes before the real create bridge call and adopts immediate output after resolution', async () => {
  const response = Promise.withResolvers<{ id: string }>();
  let id = '';
  transport.call.mockImplementation((_method: string, _plugin: string, _connection: string, encoded: string) => {
    id = JSON.parse(encoded).session_id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    for (const listener of transport.listeners.get(`core/logs/lines/${id}`) ?? []) listener({ data: '[{"content":"immediate"}]' });
    for (const listener of transport.listeners.get(`core/logs/event/${id}`) ?? []) listener({ data: '{"type":5,"source_id":""}' });
    return response.promise;
  });
  const creation = CreateSession('plugin', 'connection', options);
  const onLines = vi.fn();
  const onEvent = vi.fn();
  response.resolve({ id });
  await creation;
  const disconnect = SubscribeSessionEvents(id, { onLines, onEvent });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([{ content: 'immediate' }]);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 5, source_id: '' });
  disconnect();
});

it('removes early subscriptions when the create bridge rejects', async () => {
  transport.call.mockRejectedValue(new Error('Forbidden'));
  await expect(CreateSession('plugin', 'connection', options)).rejects.toThrow('Forbidden');
  expect([...transport.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

function emit(sessionId: string, channel: 'lines' | 'event', data: unknown) {
  for (const listener of transport.listeners.get(`core/logs/${channel}/${sessionId}`) ?? []) listener({ data });
}

const listenerCount = () => [...transport.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);

it('preserves session readiness and terminal state independently of bounded source event bursts', async () => {
  const id = 'burst';
  const response = Promise.withResolvers<{ id: string }>();
  transport.call.mockReturnValue(response.promise);
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: id });
  const ready = { type: 6, source_id: '' };
  const ended = { type: 5, source_id: '' };
  emit(id, 'event', ready);
  for (let i = 0; i < 150; i++) emit(id, 'event', { type: 1, source_id: `source-${i}` });
  emit(id, 'event', ended);
  response.resolve({ id });
  await creation;
  const onEvent = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines: vi.fn(), onEvent });
  expect(onEvent).toHaveBeenCalledTimes(102);
  expect(onEvent.mock.calls[0][0]).toEqual(ready);
  expect(onEvent.mock.calls[1][0]).toEqual({ type: 1, source_id: 'source-50' });
  expect(onEvent.mock.calls.at(-1)?.[0]).toEqual(ended);
  disconnect();
});

it.each(['lines', 'event'] as const)('disconnects live listeners when replaying %s throws', async channel => {
  const id = `throws-${channel}`;
  transport.call.mockResolvedValue({ id });
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: id });
  emit(id, channel, channel === 'lines' ? [{ content: 'early' }] : { type: 6, source_id: '' });
  await creation;
  const fail = () => { throw new Error('consumer failed'); };
  expect(() => SubscribeSessionEvents(id, {
    onLines: channel === 'lines' ? fail : vi.fn(),
    onEvent: channel === 'event' ? fail : vi.fn(),
  })).toThrow('consumer failed');
  expect(listenerCount()).toBe(0);
  const onEvent = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines: vi.fn(), onEvent });
  expect(onEvent).not.toHaveBeenCalled();
  disconnect();
});

it('keeps pending creation output beyond sixty seconds and starts expiry only after success', async () => {
  vi.useFakeTimers();
  const id = 'slow';
  const response = CancellablePromise.withResolvers<{ id: string }>();
  transport.call.mockReturnValue(response.promise);
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: id });
  emit(id, 'event', { type: 6, source_id: '' });
  vi.advanceTimersByTime(90000);
  expect(listenerCount()).toBe(2);
  emit(id, 'lines', [{ content: 'slow success' }]);
  response.resolve({ id });
  await creation;
  vi.advanceTimersByTime(59999);
  const onLines = vi.fn();
  const onEvent = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines, onEvent });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([{ content: 'slow success' }]);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 6, source_id: '' });
  disconnect();
  expect(vi.getTimerCount()).toBe(0);
});

it('expires successful creation when no consumer adopts its output', async () => {
  vi.useFakeTimers();
  const id = 'abandoned';
  transport.call.mockResolvedValue({ id });
  await CreateSession('plugin', 'connection', { ...options, session_id: id });
  expect(listenerCount()).toBe(2);
  vi.advanceTimersByTime(60000);
  expect(listenerCount()).toBe(0);
});

it('releases listeners when the bridge throws synchronously', () => {
  transport.call.mockImplementation(() => { throw new Error('bridge failed'); });
  expect(() => CreateSession('plugin', 'connection', options)).toThrow('bridge failed');
  expect(listenerCount()).toBe(0);
});

it('releases listeners synchronously when creation is cancelled', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  transport.call.mockReturnValue(new CancellablePromise<{ id: string }>(() => {}, cancel));
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: 'cancelled' });
  const rejected = expect(creation).rejects.toMatchObject({ name: 'CancelError' });
  const cause = new Error('User cancelled creation.');
  const cancelled = creation.cancel(cause);
  expect(listenerCount()).toBe(0);
  await cancelled;
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(cause);
});

it.each([null, { id: 'wrong-id' }])('releases listeners for invalid session responses: %s', async response => {
  transport.call.mockResolvedValue(response);
  await expect(CreateSession('plugin', 'connection', options)).rejects.toThrow('Log provider returned an invalid session.');
  expect(listenerCount()).toBe(0);
});

it('releases the first listener when the second subscription throws synchronously', () => {
  const subscribe = Events.On;
  const spy = vi.spyOn(Events, 'On').mockImplementation((...args) => {
    if (args[0].includes('/event/')) throw new Error('subscription failed');
    return subscribe(...args);
  });
  try {
    expect(() => CreateSession('plugin', 'connection', options)).toThrow('subscription failed');
    expect(listenerCount()).toBe(0);
    expect(transport.call).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('cancels a stalled real bridge promise at its deadline and discards captured and late output', async () => {
  vi.useFakeTimers();
  const id = 'stalled';
  const cancel = vi.fn();
  let resolve!: (value: { id: string }) => void;
  const response = new CancellablePromise<{ id: string }>(res => { resolve = res; }, cancel);
  transport.call.mockReturnValue(response);
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: id });
  const rejected = expect(creation).rejects.toThrow('Log session creation timed out after 120 seconds.');
  emit(id, 'lines', [{ content: 'before deadline' }]);
  emit(id, 'event', { type: 6, source_id: '' });
  await vi.advanceTimersByTimeAsync(119999);
  expect(listenerCount()).toBe(2);
  expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(cancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    message: 'Log session creation timed out after 120 seconds.',
  }));
  expect(listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  resolve({ id });
  emit(id, 'lines', [{ content: 'after deadline' }]);
  const onLines = vi.fn();
  const onEvent = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines, onEvent });
  expect(onLines).not.toHaveBeenCalled();
  expect(onEvent).not.toHaveBeenCalled();
  disconnect();
});

it('clears the create deadline after real bridge success without cancelling the completed call', async () => {
  vi.useFakeTimers();
  const id = 'completed';
  const cancel = vi.fn();
  let resolve!: (value: { id: string }) => void;
  transport.call.mockReturnValue(new CancellablePromise<{ id: string }>(res => { resolve = res; }, cancel));
  const creation = CreateSession('plugin', 'connection', { ...options, session_id: id });
  resolve({ id });
  await creation;
  const disconnect = SubscribeSessionEvents(id, { onLines: vi.fn(), onEvent: vi.fn() });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120000);
  expect(cancel).not.toHaveBeenCalled();
  disconnect();
});

const byteBudget = 8 * 1024 * 1024;
function recordWithBytes(bytes: number) {
  const record = { content: '', fields: { label: '😀' }, source_id: 'source' };
  const overhead = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  return { ...record, content: 'x'.repeat(bytes - overhead) };
}

it('retains an exact wire-byte boundary including UTF-8 metadata, then evicts the oldest record', () => {
  const id = 'byte-boundary';
  PrepareSessionEvents(id);
  const first = recordWithBytes(byteBudget / 2);
  const second = { ...first, source_id: 'newest' };
  emit(id, 'lines', [first, second]);
  const onLines = vi.fn();
  let disconnect = SubscribeSessionEvents(id, { onLines, onEvent: vi.fn() });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([first, second]);
  disconnect();
  PrepareSessionEvents(id);
  emit(id, 'lines', [first, second]);
  const newest = { content: 'newest' };
  emit(id, 'lines', [newest]);
  onLines.mockClear();
  disconnect = SubscribeSessionEvents(id, { onLines, onEvent: vi.fn() });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([second, newest]);
  disconnect();
});

it('drops oversized records, retains newer entries, and preserves lifecycle and source events independently', () => {
  const id = 'oversized';
  PrepareSessionEvents(id);
  emit(id, 'lines', [{ content: 'old' }, recordWithBytes(byteBudget + 1), { content: 'new' }]);
  for (let type = 0; type <= 6; type++) {
    emit(id, 'event', { type, source_id: '', detail: 'old' });
    emit(id, 'event', { type, source_id: '', detail: 'latest' });
  }
  for (let i = 0; i < 110; i++) emit(id, 'event', { type: 1, source_id: `source-${i}` });
  const onLines = vi.fn();
  const onEvent = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines, onEvent });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([{ content: 'new' }]);
  expect(onEvent).toHaveBeenCalledTimes(107);
  expect(onEvent.mock.calls.slice(0, 7).map(call => call[0])).toEqual(
    Array.from({ length: 7 }, (_, type) => ({ type, source_id: '', detail: 'latest' })),
  );
  expect(onEvent.mock.calls[7][0]).toEqual({ type: 1, source_id: 'source-10' });
  disconnect();
});

it.each(['release', 'connect'] as const)('resets retained byte accounting after %s', action => {
  const id = `reset-${action}`;
  const handoff = PrepareSessionEvents(id);
  emit(id, 'lines', [recordWithBytes(byteBudget)]);
  if (action === 'release') handoff.release();
  else SubscribeSessionEvents(id, { onLines: vi.fn(), onEvent: vi.fn() })();
  PrepareSessionEvents(id);
  const record = recordWithBytes(byteBudget);
  emit(id, 'lines', [record]);
  const onLines = vi.fn();
  const disconnect = SubscribeSessionEvents(id, { onLines, onEvent: vi.fn() });
  expect(onLines).toHaveBeenCalledExactlyOnceWith([record]);
  disconnect();
});
