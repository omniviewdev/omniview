import { describe, expect, it } from 'vitest';
import { comparisonSuffix, comparisonUnit, cpuRate, histogramBuckets, metricSeries, metricUnit, pointKey } from './model';

describe('diagnostic presentation semantics', () => {
  const previous = { value: 10, elapsedSeconds: 1, session: 'one', start: 'start' };
  it('derives CPU cores from monotonic elapsed seconds and retains observed zero', () => {
    expect(cpuRate(previous, { ...previous, value: 11, elapsedSeconds: 3 })).toBe(0.5);
    expect(cpuRate(previous, { ...previous, elapsedSeconds: 3 })).toBe(0);
  });
  it('leaves restart, reset and collection gaps unknown', () => {
    expect(cpuRate(previous, { ...previous, value: 9, elapsedSeconds: 3 })).toBeNull();
    expect(cpuRate(previous, { ...previous, session: 'two', elapsedSeconds: 3 })).toBeNull();
    expect(cpuRate(previous, { ...previous, start: 'reset', elapsedSeconds: 3 })).toBeNull();
    expect(cpuRate(previous, { ...previous, elapsedSeconds: 9 })).toBeNull();
    expect(cpuRate(previous, previous)).toBeNull();
    expect(cpuRate(previous, { ...previous, session: '', elapsedSeconds: 3 })).toBeNull();
  });
  it('formats counter comparisons as endpoint rates, not lifetime totals', () => {
    expect(comparisonUnit('', 'counter')).toEqual({ kind: 'rate', numerator: 'count' });
    expect(comparisonUnit('By', 'counter')).toEqual({ kind: 'rate', numerator: 'bytes' });
    expect(comparisonUnit('ms', 'histogram')).toEqual({ kind: 'duration', base: 'milliseconds' });
    expect(metricUnit('arbitrary')).toBeNull();
  });
  it('does not infer ratios or CPU semantics from dimensionless or seconds units', () => {
    expect(metricUnit('1')).toEqual({ kind: 'number' });
    for (const unit of ['{plugin}', '{operation}', '{job}', '{allocation}']) {
      expect(metricUnit(unit)).toEqual({ kind: 'count' });
    }

    expect(comparisonUnit('s', 'counter', 'omniview.process.cpu_time')).toEqual({ kind: 'cpu', base: 'cores' });
    expect(comparisonUnit('s', 'counter', 'work.duration')).toEqual({ kind: 'number' });
    expect(comparisonSuffix('s', 'counter', 'work.duration')).toBe('s/s');
    expect(comparisonSuffix('s', 'counter', 'omniview.process.cpu_time')).toBe('');
  });
  it('preserves explicit noncumulative histogram boundaries and open tails', () => {
    expect(histogramBuckets([1, 5])).toEqual([
      { id: '0', lower: null, upper: 1 },
      { id: '1', lower: 1, upper: 5 },
      { id: '2', lower: 5, upper: null },
    ]);
  });
  it('retains every attribute series admitted by the collector bound', () => {
    const points = Array.from({ length: 16 }, (_, index) => ({
      attributes: { operation: `operation-${index}` }, value: index, count: 0, sum: 0,
      bounds: [], bucketCounts: [], startTime: '2026-11-07T00:00:00Z',
    }));
    const series = metricSeries({ name: 'work', description: 'Work', unit: '{item}', kind: 'gauge', points }, []);
    expect(series).toHaveLength(16);
    expect(series[15].label).toBe('operation: operation-15');
  });
  it('keeps series identity stable across attribute order changes', () => {
    expect(pointKey({ operation: 'list', status: 'ok' })).toBe(pointKey({ status: 'ok', operation: 'list' }));
  });
});
