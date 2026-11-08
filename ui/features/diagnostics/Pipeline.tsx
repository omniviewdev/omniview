import { EmptyState } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, RankedBars } from '@omniviewdev/base-ui/metrics';
import type { MetricUnit } from '@omniviewdev/base-ui/metrics';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import { metricTitle } from './display';
import { MetricGrid } from './MetricGrid';
import type { Metric, Snapshot } from './model';
import styles from './Performance.module.css';

const count: MetricUnit = { kind: 'count' };
const bytes: MetricUnit = { kind: 'bytes', display: 'binary' };

const stateLabels: Readonly<Record<string, string>> = {
  queued: 'Queued',
  inflight: 'In flight',
  catalog_inflight: 'Catalog reads',
  catalog_waiters: 'Catalog waiting',
  cache_entries: 'Cached',
  observations: 'Observations',
};
const eventLabels: Readonly<Record<string, string>> = {
  cache_hit_pairs: 'Cache hits',
  cache_miss_pairs: 'Cache misses',
  dispatch: 'Dispatched',
  cancel_interest: 'Interest canceled',
  cancel_provider: 'Provider canceled',
};

export function Pipeline({ samples, updating, health }: { samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const metrics = samples.at(-1)?.metrics ?? [];
  const named = (name: string): Metric | undefined => metrics.find(metric => metric.name === name);
  const state = named('omniview.metric.pipeline.state');
  const stateBytes = named('omniview.metric.pipeline.state_bytes');
  const events = named('omniview.metric.pipeline.events');
  const latency = metrics.filter(metric => metric.kind === 'histogram' && metric.name.startsWith('omniview.metric.pipeline.'));
  const work = named('omniview.metric.pipeline.work');
  const observed = (state?.points.length ?? 0) > 0 || (events?.points.length ?? 0) > 0 || latency.length > 0;
  if (!observed) {
    return <EmptyState size='sm' title='No metric queries yet' />;
  }

  const completeness = health ? health.complete ? 'complete' as const : 'partial' as const : 'unknown' as const;
  const eventItems = (events?.points ?? []).map(point => ({ id: point.attributes.event ?? '', label: eventLabels[point.attributes.event ?? ''] ?? point.attributes.event ?? 'Event', value: point.value }));
  const workItems = (work?.points ?? []).map(point => ({ id: point.attributes.work ?? '', label: point.attributes.work ?? 'Work', value: point.value }));
  return <div className={styles.Dashboard}>
    {state && <div className={styles.Tiles}>
      {state.points.map(point => <MetricPanel key={point.attributes.state} title={stateLabels[point.attributes.state ?? ''] ?? point.attributes.state ?? metricTitle(state.name)} value={<MetricValue value={point.value} unit={count} size='lg' />} state={{ kind: 'data', updating, completeness }} />)}
      {(stateBytes?.points ?? []).map(point => <MetricPanel key={`bytes-${point.attributes.state}`} title={`${point.attributes.state === 'snapshots' ? 'Snapshot' : 'Cache'} memory`} value={<MetricValue value={point.value} unit={bytes} size='lg' />} state={{ kind: 'data', updating, completeness }} />)}
    </div>}
    <div className={styles.Charts}>
      {eventItems.length > 0 && <MetricPanel title='Cache and dispatch' state={{ kind: 'data', updating, completeness }}><RankedBars items={eventItems} unit={count} limit={6} label='Pipeline events' /></MetricPanel>}
      {workItems.length > 0 && <MetricPanel title='Work dispatched' state={{ kind: 'data', updating, completeness }}><RankedBars items={workItems} unit={count} limit={4} label='Pipeline work' /></MetricPanel>}
    </div>
    {latency.length > 0 && <MetricGrid metrics={latency} samples={samples} updating={updating} health={health} />}
  </div>;
}
