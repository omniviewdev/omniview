import { describe, expect, it } from 'vitest';
import { pluginRows } from './Plugins';
import type { Snapshot } from './model';

const point = (plugin: string, outcome: string | undefined, value: number, extra: Record<string, unknown> = {}) => ({
  attributes: { plugin, ...(outcome ? { outcome } : {}) }, value, count: 0, sum: 0, bounds: [], bucketCounts: [], startTime: '2026-11-07T00:00:00Z', ...extra,
});
const identity = { instanceID: 'i', sessionID: 's', generation: 'g', version: '', revision: '', sourceState: '', buildDate: '', configID: '', configScope: '' };
const health = { complete: true, errors: 0, dropped: 0, gaps: 0, lastError: '', remoteErrors: 0, remoteDropped: 0 };
const sample = (sequence: number, elapsedSeconds: number, cpu: number): Snapshot => ({
  schemaVersion: 1, identity, sequence, timestamp: new Date(Date.UTC(2026, 10, 7, 0, 0, elapsedSeconds)).toISOString(), elapsedSeconds, health,
  metrics: [
    { name: 'omniview.plugin.process.cpu_time', description: '', unit: 's', kind: 'counter', points: [point('kubernetes', undefined, cpu)] },
    { name: 'omniview.plugin.process.memory_rss', description: '', unit: 'By', kind: 'gauge', points: [point('kubernetes', undefined, 1024)] },
    { name: 'omniview.operation.calls', description: '', unit: '', kind: 'counter', points: [point('kubernetes', 'success', 8), point('kubernetes', 'error', 2), point('aws', 'success', 5)] },
  ],
});

describe('pluginRows', () => {
  it('attributes work to the host-assigned plugin and derives CPU from observed deltas', () => {
    const rows = pluginRows([sample(1, 0, 10), sample(2, 2, 11)]);
    expect(rows.map(row => row.id)).toEqual(['aws', 'kubernetes']);
    const kubernetes = rows.find(row => row.id === 'kubernetes');
    expect(kubernetes).toMatchObject({ cpu: 0.5, memory: 1024, operations: 10, errors: 2 });
  });

  it('keeps unobserved process usage unknown rather than zero', () => {
    const aws = pluginRows([sample(1, 0, 10), sample(2, 2, 11)]).find(row => row.id === 'aws');
    expect(aws?.cpu).toBeNull();
    expect(aws?.memory).toBeNull();
    expect(aws?.operations).toBe(5);
  });

  it('reports plugin-metric availability from the host-owned status, not from absent points', () => {
    const status = (plugin: string, state: string) => point(plugin, undefined, 1, { attributes: { plugin, state } });
    const withStatus = sample(1, 0, 10);
    withStatus.metrics?.push({ name: 'omniview.plugin.diagnostics.status', description: '', unit: '1', kind: 'gauge', points: [status('kubernetes', 'ok'), status('aws', 'unsupported'), status('legacy', 'stale')] });
    const rows = pluginRows([withStatus]);
    expect(rows.map(row => [row.id, row.reporting])).toEqual([['aws', 'unsupported'], ['kubernetes', 'ok'], ['legacy', 'stale']]);
    expect(pluginRows([sample(1, 0, 10)]).every(row => row.reporting === null)).toBe(true);
  });
});
