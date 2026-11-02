import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticRuntimeIdentity, registerDiagnosticRuntime } from './runtimeIdentity';

type Registration = {
  windowName: string;
  token: string;
  pending?: boolean;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('diagnostic runtime startup identity', () => {
  it('stays unavailable before browser connection and adopts only the registered browser identity', async () => {
    vi.useFakeTimers();
    const identity = createDiagnosticRuntimeIdentity();
    let browserConnected = false;
    let registrations = 0;
    const client = {
      async Register(): Promise<Registration> {
        registrations++;
        return browserConnected ? { windowName: 'browser-3', token: 'browser-lease' } : { pending: true, windowName: '', token: '' };
      },
      Unregister: vi.fn(async () => undefined),
    };
    const stop = registerDiagnosticRuntime(client, identity);
    await vi.advanceTimersByTimeAsync(1000);
    expect(registrations).toBe(5);
    expect(identity.getSnapshot()).toEqual({ windowName: null, identityError: null });
    browserConnected = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(identity.getSnapshot()).toEqual({ windowName: 'browser-3', identityError: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(registrations).toBe(6);
    stop();
    expect(client.Unregister).toHaveBeenCalledWith('browser-lease');
    expect(identity.getSnapshot().windowName).toBeNull();
  });

  it('bounds pending readiness retries and reports a safe unavailable error', async () => {
    vi.useFakeTimers();
    const identity = createDiagnosticRuntimeIdentity();
    const client = {
      Register: vi.fn(async () => ({ pending: true, windowName: '', token: '' })),
      Unregister: vi.fn(async () => undefined),
    };
    const stop = registerDiagnosticRuntime(client, identity);
    await vi.advanceTimersByTimeAsync(5000);
    expect(identity.getSnapshot().identityError).toContain('identity is unavailable');
    expect(client.Register).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.Register).toHaveBeenCalledTimes(21);
    expect(client.Unregister).not.toHaveBeenCalled();
    stop();
  });

  it('does not retry generic transport failures or expose freeform errors', async () => {
    vi.useFakeTimers();
    const identity = createDiagnosticRuntimeIdentity();
    const client = {
      Register: vi.fn(async (): Promise<Registration> => {
        throw new Error('private transport details'); 
      }),
      Unregister: vi.fn(async () => undefined),
    };
    const stop = registerDiagnosticRuntime(client, identity);
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.Register).toHaveBeenCalledOnce();
    expect(identity.getSnapshot()).toEqual({ windowName: null, identityError: 'Extension diagnostics runtime identity is unavailable.' });
    stop();
  });

  it('unregisters a late old lease without clearing the replacement identity', async () => {
    vi.useFakeTimers();
    const identity = createDiagnosticRuntimeIdentity();
    const oldRegistration = Promise.withResolvers<Registration>();
    const unregister = vi.fn(async () => undefined);
    const stopOld = registerDiagnosticRuntime({
      Register: async () => oldRegistration.promise,
      Unregister: unregister,
    }, identity);
    stopOld();
    const stopNew = registerDiagnosticRuntime({
      Register: async () => ({ windowName: 'browser-4', token: 'new-lease' }),
      Unregister: unregister,
    }, identity);
    await vi.advanceTimersByTimeAsync(0);
    oldRegistration.resolve({ windowName: 'browser-3', token: 'old-lease' });
    await vi.advanceTimersByTimeAsync(0);
    expect(unregister).toHaveBeenCalledWith('old-lease');
    expect(identity.getSnapshot().windowName).toBe('browser-4');
    stopOld();
    expect(identity.getSnapshot().windowName).toBe('browser-4');
    stopNew();
    expect(unregister).toHaveBeenCalledWith('new-lease');
  });

  it('cancels pending readiness timers on teardown', async () => {
    vi.useFakeTimers();
    const identity = createDiagnosticRuntimeIdentity();
    const client = {
      Register: vi.fn(async () => ({ pending: true, windowName: '', token: '' })),
      Unregister: vi.fn(async () => undefined),
    };
    const stop = registerDiagnosticRuntime(client, identity);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.Register).toHaveBeenCalledOnce();
    expect(identity.getSnapshot()).toEqual({ windowName: null, identityError: null });
  });
});
