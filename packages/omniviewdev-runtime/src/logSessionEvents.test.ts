import { afterEach, expect, it, vi } from 'vitest';
import { CreateSession, SubscribeSessionEvents } from './logs';
import type { LogSessionRequest } from './logs';

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
afterEach(() => { transport.listeners.clear(); vi.clearAllMocks(); });
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
