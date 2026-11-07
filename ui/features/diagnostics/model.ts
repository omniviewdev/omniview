import type { Snapshot, Metric } from '@omniviewdev/runtime/api';
import type { MetricUnit, NumericSeries } from '@omniviewdev/base-ui/metrics';

export type { Snapshot, Metric, Capture, CaptureSummary, Comparison } from '@omniviewdev/runtime/api';

export function isCpuTime(name: string): boolean {
  return name === 'omniview.process.cpu_time' || name === 'omniview.plugin.process.cpu_time';
}

export function metricUnit(unit: string): MetricUnit | null {
  switch (unit) {
    case 'By': case 'bytes': return { kind: 'bytes', display: 'binary' };
    case 's': return { kind: 'duration', base: 'seconds' };
    case 'ms': return { kind: 'duration', base: 'milliseconds' };
    case '%': return { kind: 'percent' };
    case '1': return { kind: 'number' };
    case '': return { kind: 'count' };
    default: return /^\{[^{}]+\}$/.test(unit) ? { kind: 'count' } : null;
  }
}

export function comparisonUnit(unit: string, kind: string, name = ''): MetricUnit | null {
  const base = metricUnit(unit);
  if (kind !== 'counter') {
    return base;
  }

  if (base?.kind === 'count') {
    return { kind: 'rate', numerator: 'count' };
  }

  if (base?.kind === 'bytes') {
    return { kind: 'rate', numerator: 'bytes' };
  }

  if (unit === 's') {
    return isCpuTime(name) ? { kind: 'cpu', base: 'cores' } : { kind: 'number' };
  }

  return null;
}

export function comparisonSuffix(unit: string, kind: string, name: string) {
  return kind === 'counter' && unit === 's' && !isCpuTime(name) ? 's/s' : '';
}

export function pointKey(attributes: Readonly<Record<string, string | undefined>>): string {
  return JSON.stringify(Object.entries(attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

export function cpuRate(previous: { value: number; elapsedSeconds: number; session: string; start: string }, current: { value: number; elapsedSeconds: number; session: string; start: string }) {
  const elapsed = current.elapsedSeconds - previous.elapsedSeconds;
  if (elapsed <= 0 || elapsed > 6 || !current.session || current.session !== previous.session || current.start !== previous.start || current.value < previous.value) {
    return null;
  }

  const value = (current.value - previous.value) / elapsed;
  return Number.isFinite(value) ? value : null;
}

export function metricSeries(metric: Metric, samples: Snapshot[]): NumericSeries[] {
  return (metric.points ?? []).map(point => {
    const key = pointKey(point.attributes);
    const dimensions = Object.entries(point.attributes ?? {}).map(([name, value]) => `${name}: ${value}`).join(' · ');
    return {
      id: `${metric.name}:${key}`,
      label: dimensions === '' ? metric.description === '' ? metric.name : metric.description : dimensions,
      points: samples.slice(-300).map((sample, index, window) => {
        const value = sample.metrics?.find(item => item.name === metric.name)?.points?.find(item => pointKey(item.attributes) === key);
        const timeMs = new Date(sample.timestamp).getTime();
        if (isCpuTime(metric.name) && value) {
          const previous = window[index - 1];
          const prior = previous?.metrics?.find(item => item.name === metric.name)?.points?.find(item => pointKey(item.attributes) === key);
          return { timeMs, value: previous && prior ? cpuRate(
            { value: prior.value, elapsedSeconds: previous.elapsedSeconds, session: previous.identity.sessionID, start: prior.startTime },
            { value: value.value, elapsedSeconds: sample.elapsedSeconds, session: sample.identity.sessionID, start: value.startTime },
          ) : null };
        }

        return { timeMs, value: value && Number.isFinite(value.value) ? value.value : null };
      }),
    };
  });
}

export function histogramBuckets(bounds: number[]) {
  return [...bounds, null].map((upper, index) => ({ id: String(index), lower: index === 0 ? null : bounds[index - 1], upper }));
}
