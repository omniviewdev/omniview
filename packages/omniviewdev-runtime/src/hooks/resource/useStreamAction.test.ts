import { act, renderHook } from '@testing-library/react';
import type { Mock } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import { CancellablePromise, CancelError } from '@wailsio/runtime/cancellable';

let open: Mock;
let attach: Mock;
let close: Mock;
const update = vi.fn();
const add = vi.fn();
const snackbar = vi.fn();
const listeners = new Map<string, (event: { data: unknown }) => void>();
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: () => 'neutral' }));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: snackbar }) }));
vi.mock('../operations/useOperations', () => ({ useOperations: () => ({ addOperation: add, updateOperation: update }) }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  get StreamAction() { return open; }, get AttachStreamAction() { return attach; }, get CancelStreamAction() { return close; },
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return { ...actual, Events: { On: (name: string, callback: (event: { data: unknown }) => void) => { listeners.set(name, callback); return () => listeners.delete(name); } } };
});
import { useStreamAction } from './useStreamAction';
const params = { actionID: 'start', id: 'opaque', namespace: '', label: 'Start' };

beforeEach(() => { listeners.clear(); update.mockClear(); add.mockClear(); snackbar.mockClear(); open = vi.fn().mockResolvedValue('host-handle'); close = vi.fn().mockResolvedValue(undefined); attach = vi.fn(); });

it('attaches listener first and reconciles completion before attachment', async () => {
  attach.mockImplementation(() => {
    expect(listeners.has('action/stream/host-handle')).toBe(true);
    return Promise.resolve({ sequence: 2, terminal: true, event: { type: 'complete', data: { message: 'Finished' } } });
  });
  const hook = renderHook(() => useStreamAction({ connectionID: 'c', resourceKey: 'opaque' }));
  await act(async () => { await hook.result.current.startStreamAction(params); });
  expect(update).toHaveBeenCalledWith('host-handle', expect.objectContaining({ status: 'completed', message: 'Finished' }));
  expect(listeners.size).toBe(0);
  expect(close).toHaveBeenCalledWith('host-handle');
});

it('does not regress a terminal live sequence when the attach response is older', async () => {
  attach.mockImplementation(() => {
    listeners.get('action/stream/host-handle')?.({ data: { sequence: 3, terminal: true, event: { type: 'complete', data: { message: 'Finished' } } } });
    return Promise.resolve({ sequence: 1, terminal: false, event: { type: 'progress', data: { message: 'Started' } } });
  });
  const hook = renderHook(() => useStreamAction({ connectionID: 'c', resourceKey: 'opaque' }));
  await act(async () => { await hook.result.current.startStreamAction(params); });
  expect(update.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'completed', message: 'Finished' });
});

it('releases established work on unmount without removing unrelated listeners', async () => {
  listeners.set('unrelated', () => undefined);
  attach.mockResolvedValue({ sequence: 1, terminal: false, event: { type: 'progress', data: {} } });
  const hook = renderHook(() => useStreamAction({ connectionID: 'c', resourceKey: 'opaque' }));
  await act(async () => { await hook.result.current.startStreamAction(params); });
  hook.unmount();
  expect(close).toHaveBeenCalledWith('host-handle');
  expect(listeners.has('unrelated')).toBe(true);
  expect(listeners.has('action/stream/host-handle')).toBe(false);
});

it('preserves live terminal success when cleanup cancels an unresolved real attachment promise', async () => {
  const cancelled = vi.fn();
  attach.mockReturnValue(new CancellablePromise<never>(() => {}, cancelled));
  const hook = renderHook(() => useStreamAction({ connectionID: 'c', resourceKey: 'opaque' }));
  let started: Promise<string>;
  await act(async () => {
    started = hook.result.current.startStreamAction(params);
    await Promise.resolve();
  });
  expect(attach).toHaveBeenCalledWith('host-handle');
  await act(async () => {
    listeners.get('action/stream/host-handle')?.({ data: { sequence: 3, terminal: true, event: { type: 'complete', data: { message: 'Finished' } } } });
    await expect(started).resolves.toBe('host-handle');
  });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(update.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'completed', message: 'Finished' });
  expect(snackbar).toHaveBeenCalledExactlyOnceWith('Finished', 'success');
  expect(listeners.size).toBe(0);
});

it('does not reinterpret an owning cancellation as successful terminal cleanup', async () => {
  attach.mockReturnValue(new CancellablePromise<never>(() => {}));
  const hook = renderHook(() => useStreamAction({ connectionID: 'c', resourceKey: 'opaque' }));
  let started: Promise<string>;
  await act(async () => {
    started = hook.result.current.startStreamAction(params);
    await Promise.resolve();
  });
  await act(async () => {
    const rejected = expect(started).rejects.toBeInstanceOf(CancelError);
    hook.result.current.cancelStreamAction('host-handle');
    await rejected;
  });
  expect(update.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'cancelled' });
  expect(snackbar).not.toHaveBeenCalled();
});
