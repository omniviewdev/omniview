import { Events } from '@wailsio/runtime';
import { OpenMetricsObservation, AttachMetricsObservation, CloseMetricsObservation, RefreshMetricsObservation } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';
import { observeFrontendOperation, recordFrontendSpan } from '../../telemetry/frontendSpans';
import type { MetricsObservationSpec, MetricsObservationSnapshot } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';

type Receiver = (snapshot: MetricsObservationSnapshot) => void;
const receivers = new Map<string, Receiver>();
let stopRouter: (() => void) | undefined;

/** A session-local observation lease. Closing also retires an unresolved Open. */
export interface MetricObservationLease {
  close(): void;
  refresh(): Promise<void>;
}

/**
 * Register routing before Open and activate only after its acknowledgement is applied.
 * The host owns scheduling, admission, coalescing and data retention. This client has
 * no cache or timer. Tokens never identify authority; the authenticated host session does.
 */
export function observeMetrics(spec: MetricsObservationSpec, receive: Receiver, fail: (error: Error) => void): MetricObservationLease {
  const token = crypto.randomUUID();
  let closed = false;
  let generation = -1;
  let sequence = -1;
  const accept: Receiver = snapshot => {
    if (closed || snapshot.client_token !== token) return;
    if (snapshot.generation < generation || (snapshot.generation === generation && snapshot.sequence <= sequence)) return;
    generation = snapshot.generation;
    sequence = snapshot.sequence;
    // Freeze received transport objects in place; no second transport cache or copy.
    for (const result of snapshot.data?.results ?? []) {
      for (const point of result.points ?? []) Object.freeze(point);
      if (result.points) Object.freeze(result.points);
      if (result.dimensions) Object.freeze(result.dimensions);
      if (result.source) Object.freeze(result.source);
      Object.freeze(result);
    }
    if (snapshot.data) {
      if (snapshot.data.results) Object.freeze(snapshot.data.results);
      if (snapshot.data.warnings) Object.freeze(snapshot.data.warnings);
      Object.freeze(snapshot.data);
    }
    Object.freeze(snapshot);
    receive(snapshot);
  };
  receivers.set(token, accept);
  try {
    stopRouter ??= Events.On('metric/observation', event => {
      const snapshot = event.data as MetricsObservationSnapshot;
      const receiver = receivers.get(snapshot.client_token);
      if (receiver) receiver(snapshot);
      else {
        const now = Date.now();
        recordFrontendSpan('frontend.event.anomaly', { family: 'metric', kind: 'unmatched_receiver' }, now, now, false);
      }
    });
  } catch (error) {
    receivers.delete(token);
    throw error;
  }
  const close = () => {
    if (closed) return;
    closed = true;
    receivers.delete(token);
    if (!receivers.size) { stopRouter?.(); stopRouter = undefined; }
    // Retired views cannot receive errors; host session retirement also owns cleanup.
    void CloseMetricsObservation(token).catch(() => undefined);
  };
  const report = (error: unknown) => {
    if (closed) return;
    close();
    fail(error instanceof Error ? error : new Error(String(error)));
  };
  void observeFrontendOperation(
    'frontend.metric_stream',
    { plugin_id: spec.owner_plugin_id, operation: 'subscribe' },
    OpenMetricsObservation({ client_token: token, spec }),
  ).then(async snapshot => {
    if (closed) {
      await CloseMetricsObservation(token);
      return;
    }
    accept(snapshot);
    await AttachMetricsObservation(token);
  }).catch(report);
  return {
    close,
    async refresh() { if (!closed) await RefreshMetricsObservation(token); },
  };
}
