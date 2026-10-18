import { afterEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const nativeError = vi.fn();
  console.error = nativeError;
  return { log: vi.fn(), nativeError, originalConsole };
});
vi.mock('@omniviewdev/runtime/api', () => ({ DiagnosticsClient: { Log: backend.log } }));

import { bridgeSink } from './bridgeSink';
import { patchConsole } from './patchConsole';

afterEach(() => {
  Object.assign(console, backend.originalConsole);
});

it('reports an unavailable diagnostics backend locally without sending its failure back to that backend', async () => {
  const failure = new Error('Owned backend is restarting');
  // Allow an accidental second send to settle so RED cannot livelock the runner.
  backend.log.mockResolvedValue(undefined).mockRejectedValueOnce(failure);
  patchConsole(bridgeSink);

  console.warn('A frontend event while the owned backend is restarting');
  await Promise.resolve();
  await Promise.resolve();

  expect(backend.nativeError.mock.calls.some(args => args.includes(failure))).toBe(true);
  // This bounds an asynchronous feedback loop, not ordinary adapter forwarding.
  expect(backend.log).toHaveBeenCalledTimes(1);
});
