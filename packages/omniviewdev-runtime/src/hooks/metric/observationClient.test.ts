import { beforeEach, expect, it, vi } from 'vitest';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
const transport = vi.hoisted(() => ({ open: vi.fn(), attach: vi.fn(), close: vi.fn(), refresh: vi.fn(), listen: vi.fn() }));
vi.mock('@wailsio/runtime', async importOriginal => ({ ...(await importOriginal<object>()), Events: { On: transport.listen } }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper', () => ({
  OpenMetricsObservation: transport.open, AttachMetricsObservation: transport.attach,
  CloseMetricsObservation: transport.close, RefreshMetricsObservation: transport.refresh,
}));
import { observeMetrics } from './observationClient';
let event: (event: { data: MetricsObservationSnapshot }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  transport.listen.mockImplementation((_topic, listener) => { event = listener; return vi.fn(); });
  transport.close.mockResolvedValue(undefined);
  transport.attach.mockResolvedValue(undefined);
});
const spec = {} as MetricsObservationSpec;
it('closes immediately while Open is unresolved and never attaches a retired lease', async () => {
  const { promise, resolve: acknowledge } = Promise.withResolvers<MetricsObservationSnapshot>();
  transport.open.mockReturnValue(promise);
  const receive = vi.fn();
  const lease = observeMetrics(spec, receive, vi.fn());
  const token = transport.open.mock.calls[0][0].client_token;
  lease.close();
  expect(transport.close).toHaveBeenCalledWith(token);
  acknowledge({ client_token: token, generation: 1, sequence: 1 } as MetricsObservationSnapshot);
  await Promise.resolve();
  expect(transport.attach).not.toHaveBeenCalled();
  expect(receive).not.toHaveBeenCalled();
});
it('routes before Open and rejects wrong tokens, stale generations and duplicate sequences', async () => {
  const { promise, resolve: acknowledge } = Promise.withResolvers<MetricsObservationSnapshot>();
  transport.open.mockImplementation(() => {
    expect(transport.listen).toHaveBeenCalledOnce();
    return promise;
  });
  const receive = vi.fn();
  const lease = observeMetrics(spec, receive, vi.fn());
  const token = transport.open.mock.calls[0][0].client_token;
  const emit = (generation: number, sequence: number, client_token = token) => event({ data: { client_token, generation, sequence } as MetricsObservationSnapshot });
  acknowledge({ client_token: token, generation: 2, sequence: 1 } as MetricsObservationSnapshot);
  await Promise.resolve();
  emit(2, 1);
  emit(1, 99);
  emit(3, 1, 'other-window');
  emit(2, 2);
  emit(3, 1);
  expect(receive.mock.calls.map(([snapshot]) => [snapshot.generation, snapshot.sequence])).toEqual([[2, 1], [2, 2], [3, 1]]);
  lease.close();
});
