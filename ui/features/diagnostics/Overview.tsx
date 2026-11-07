import { EmptyState } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, Sparkline, TimeSeriesChart } from '@omniviewdev/base-ui/metrics';
import type { MetricUnit, NumericSeries } from '@omniviewdev/base-ui/metrics';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import { metricTitle } from './display';
import { metricSeries } from './model';
import type { Metric, Snapshot } from './model';
import styles from './Performance.module.css';

const bytes: MetricUnit = { kind: 'bytes', display: 'binary' };
const cores: MetricUnit = { kind: 'cpu', base: 'cores' };
const count: MetricUnit = { kind: 'count' };

function find(samples: readonly Snapshot[], name: string): Metric | undefined {
  return samples.at(-1)?.metrics?.find(metric => metric.name === name);
}

function seriesOf(samples: Snapshot[], name: string, id: string, label: string): NumericSeries | null {
  const metric = find(samples, name);
  if (metric === undefined) {
    return null;
  }

  const all = metricSeries(metric, samples);
  if (all.length === 1) {
    return { ...all[0], id, label };
  }

  // Sum same-timestamp dimensions (for example CPU user + system); any unknown part makes the sum unknown.
  const points = all[0]?.points.map((point, index) => {
    const parts = all.map(series => series.points[index]?.value ?? null);
    return { timeMs: point.timeMs, value: parts.some(part => part === null) ? null : parts.reduce<number>((total, part) => total + (part ?? 0), 0) };
  }) ?? [];
  return { id, label, points };
}

function Tile({ title, series, unit, domain, updating, health }: { title: string; series: NumericSeries | null; unit: MetricUnit; domain: { startMs: number; endMs: number } | null; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const latest = series?.points.at(-1)?.value ?? null;
  return <MetricPanel title={title} value={<MetricValue value={latest} unit={unit} size='lg' />}
    state={series === null ? { kind: 'empty', message: 'Not observed' } : { kind: 'data', updating, completeness: health ? health.complete ? 'complete' : 'partial' : 'unknown' }}>
    {series !== null && domain !== null && <Sparkline series={series} domain={domain} height={44} label={`${title} trend`} />}
  </MetricPanel>;
}

export function Overview({ samples, updating, health }: { samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const first = samples[0];
  const last = samples.at(-1);
  const startMs = first ? new Date(first.timestamp).getTime() : NaN;
  const endMs = last ? new Date(last.timestamp).getTime() : NaN;
  const domain = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs ? { startMs, endMs } : null;
  const cpu = seriesOf(samples, 'omniview.process.cpu_time', 'cpu', 'CPU');
  const heap = seriesOf(samples, 'omniview.process.go_heap_bytes', 'heap', 'Heap');
  const peak = seriesOf(samples, 'omniview.process.memory_peak_rss', 'peak', 'Peak memory');
  const goroutines = seriesOf(samples, 'omniview.process.goroutines', 'goroutines', 'Goroutines');
  const plugins = seriesOf(samples, 'omniview.plugin.active', 'plugins', 'Plugins');
  const cpuParts = (() => {
    const metric = find(samples, 'omniview.process.cpu_time');
    return metric ? metricSeries(metric, samples) : [];
  })();
  if (domain === null) {
    return <EmptyState size='sm' title='Collecting measurements' />;
  }

  return <div className={styles.Dashboard}>
    <div className={styles.Tiles}>
      <Tile title={metricTitle('omniview.process.cpu_time')} series={cpu} unit={cores} domain={domain} updating={updating} health={health} />
      <Tile title={metricTitle('omniview.process.go_heap_bytes')} series={heap} unit={bytes} domain={domain} updating={updating} health={health} />
      <Tile title={metricTitle('omniview.process.goroutines')} series={goroutines} unit={count} domain={domain} updating={updating} health={health} />
      <Tile title={metricTitle('omniview.process.memory_peak_rss')} series={peak} unit={bytes} domain={domain} updating={updating} health={health} />
      <Tile title={metricTitle('omniview.plugin.active')} series={plugins} unit={count} domain={domain} updating={updating} health={health} />
    </div>
    <div className={styles.Charts}>
      {cpuParts.length > 0 && <MetricPanel title='CPU by state' state={{ kind: 'data', updating, completeness: health ? health.complete ? 'complete' : 'partial' : 'unknown' }}>
        <TimeSeriesChart series={cpuParts} unit={cores} domain={domain} maxGapMs={6000} height={160} label='CPU by state' />
      </MetricPanel>}
      {heap !== null && peak !== null && <MetricPanel title='Memory' state={{ kind: 'data', updating, completeness: health ? health.complete ? 'complete' : 'partial' : 'unknown' }}>
        <TimeSeriesChart series={[heap, peak]} unit={bytes} domain={domain} maxGapMs={6000} height={160} label='Heap and peak memory' />
      </MetricPanel>}
    </div>
  </div>;
}
