import { useState } from 'react';
import { Select, Text } from '@omniviewdev/base-ui';
import { Histogram, MetricDetails, MetricPanel, MetricValue, RankedBars, TimeSeriesChart } from '@omniviewdev/base-ui/metrics';
import { histogramBuckets, isCpuTime, metricSeries, metricUnit, pointKey } from './model';
import { metricTitle } from './display';
import type { Metric, Snapshot } from './model';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import styles from './Performance.module.css';

function MetricChart({ metric, samples, updating, health }: { metric: Metric; samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const [selected, setSelected] = useState('');
  const points = metric.points ?? [];
  const point = points.find(value => pointKey(value.attributes) === selected) ?? points[0];
  const selectedLabel = Object.entries(point?.attributes ?? {}).map(([key, label]) => `${key}: ${label}`).join(' · ');
  const cpu = isCpuTime(metric.name);
  const unit = cpu ? { kind: 'cpu' as const, base: 'cores' as const } : metricUnit(metric.unit);
  const histogram = metric.kind === 'histogram';
  const series = metricSeries(metric, samples);
  const first = samples[0];
  const last = samples.at(-1);
  const startMs = first ? new Date(first.timestamp).getTime() : null;
  const endMs = last ? new Date(last.timestamp).getTime() : null;
  const domain = startMs !== null && endMs !== null && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs ? { startMs, endMs } : null;
  const title = metricTitle(metric.name);
  const hasData = points.length > 0 && !!unit;
  return <MetricPanel title={title}
    state={!unit ? { kind: 'unsupported', message: `Unsupported unit: ${metric.unit}` } : !hasData ? { kind: 'empty', message: 'No observed samples.' } : { kind: 'data', updating, completeness: health ? health.complete ? 'complete' : 'partial' : 'unknown' }}
    details={{ content: <MetricDetails label={`${title} details`} items={[
      { id: 'instrument', label: 'Instrument', value: metric.name },
      { id: 'kind', label: 'Kind', value: metric.kind },
      { id: 'unit', label: 'Unit', value: metric.unit === '' ? 'count' : metric.unit },
      { id: 'description', label: 'Description', value: metric.description === '' ? 'Not provided' : metric.description, advanced: true },
    ]} samples={last ? [{ id: 'latest', label: 'Latest sample', status: health ? health.complete ? 'ok' : 'unknown' : 'unknown', updatedAtMs: new Date(last.timestamp).getTime() }] : undefined} /> }}
    actions={histogram && points.length > 1 ? <Select size='sm' value={pointKey(point.attributes)} onValueChange={value => {
      setSelected(value ?? ''); 
    }}><Select.Trigger aria-label={`${metric.name} distribution series`}><Select.Value>{() => selectedLabel === '' ? 'All observations' : selectedLabel}</Select.Value><Select.Icon /></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup><Select.List>{points.map(value => <Select.Item key={pointKey(value.attributes)} value={pointKey(value.attributes)}>{Object.entries(value.attributes ?? {}).map(([key, label]) => `${key}: ${label}`).join(' · ') || 'All observations'}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal></Select> : undefined}
    value={!histogram && unit && points.length === 1 ? <MetricValue value={series[0]?.points.at(-1)?.value ?? null} unit={unit} size='md' /> : undefined}>
    {hasData && unit && (histogram ? <Histogram buckets={histogramBuckets(point.bounds ?? [])} values={point.bucketCounts ?? []} unit={unit} measure='count' height={140} label={title} /> : domain ? <TimeSeriesChart series={series} unit={unit} domain={domain} maxGapMs={6000} height={140} label={title} /> : <Text size='sm' tone='muted'>Waiting for observed history.</Text>)}
    {hasData && unit && !histogram && points.length > 1 && <RankedBars items={series.map(item => ({ id: item.id, label: item.label, value: item.points.at(-1)?.value ?? null }))} unit={unit} limit={4} label={`${metric.name} current series`} />}
  </MetricPanel>;
}

export function MetricGrid({ metrics, samples, updating, health }: { metrics: Metric[]; samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  return <div className={styles.Grid}>{metrics.slice(0, 24).map(metric => <MetricChart key={metric.name} metric={metric} samples={samples} updating={updating} health={health} />)}</div>;
}
