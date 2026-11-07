import { Chip, EmptyState, Table } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, RankedBars } from '@omniviewdev/base-ui/metrics';
import type { MetricUnit } from '@omniviewdev/base-ui/metrics';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import { metricSeries } from './model';
import type { Metric, Snapshot } from './model';
import styles from './Performance.module.css';

const cores: MetricUnit = { kind: 'cpu', base: 'cores' };
const bytes: MetricUnit = { kind: 'bytes', display: 'binary' };
const count: MetricUnit = { kind: 'count' };
const millis: MetricUnit = { kind: 'duration', base: 'milliseconds' };

type PluginRow = {
  id: string;
  cpu: number | null;
  memory: number | null;
  operations: number;
  errors: number;
  latencyMs: number | null;
  crashes: number;
};

function named(samples: readonly Snapshot[], name: string): Metric | undefined {
  return samples.at(-1)?.metrics?.find(metric => metric.name === name);
}

function byPlugin(metric: Metric | undefined): Map<string, Metric['points']> {
  const groups = new Map<string, Metric['points']>();
  for (const point of metric?.points ?? []) {
    const id = point.attributes.plugin;
    if (id !== undefined && id !== '') {
      groups.set(id, [...(groups.get(id) ?? []), point]);
    }
  }

  return groups;
}

export function pluginRows(samples: Snapshot[]): PluginRow[] {
  const cpuMetric = named(samples, 'omniview.plugin.process.cpu_time');
  const cpuSeries = cpuMetric ? metricSeries(cpuMetric, samples) : [];
  const rss = byPlugin(named(samples, 'omniview.plugin.process.memory_rss'));
  const calls = byPlugin(named(samples, 'omniview.operation.calls'));
  const latency = byPlugin(named(samples, 'omniview.resource.op_duration'));
  const crashes = byPlugin(named(samples, 'omniview.plugin.crashes'));
  const active = byPlugin(named(samples, 'omniview.plugin.active'));
  const ids = new Set([...rss.keys(), ...calls.keys(), ...latency.keys(), ...crashes.keys(), ...active.keys()]);
  const total = (points: Metric['points'] | undefined) => (points ?? []).reduce((sum, point) => sum + point.value, 0);
  return [...ids].sort().map(id => {
    const series = cpuSeries.find((_, index) => cpuMetric?.points[index]?.attributes.plugin === id);
    const lastCpu = series?.points.at(-1)?.value ?? null;
    const observations = (latency.get(id) ?? []).reduce((sum, point) => sum + point.count, 0);
    const sumMs = (latency.get(id) ?? []).reduce((sum, point) => sum + point.sum, 0);
    const callPoints = calls.get(id) ?? [];
    return {
      id,
      cpu: lastCpu,
      memory: rss.has(id) ? total(rss.get(id)) : null,
      operations: total(callPoints),
      errors: total(callPoints.filter(point => point.attributes.outcome !== undefined && point.attributes.outcome !== 'success')),
      latencyMs: observations > 0 ? sumMs / observations : null,
      crashes: total(crashes.get(id)),
    };
  });
}

export function Plugins({ samples, updating, health }: { samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const rows = pluginRows(samples);
  const completeness = health ? health.complete ? 'complete' as const : 'partial' as const : 'unknown' as const;
  if (rows.length === 0) {
    return <EmptyState size='sm' title='No plugin activity observed yet' />;
  }

  const items = (pick: (row: PluginRow) => number | null) => rows.map(row => ({ id: row.id, label: row.id, value: pick(row) }));
  return <div className={styles.Dashboard}>
    <div className={styles.Charts}>
      <MetricPanel title='CPU by plugin' state={{ kind: 'data', updating, completeness }}><RankedBars items={items(row => row.cpu)} unit={cores} limit={8} label='Plugin CPU' /></MetricPanel>
      <MetricPanel title='Memory by plugin' state={{ kind: 'data', updating, completeness }}><RankedBars items={items(row => row.memory)} unit={bytes} limit={8} label='Plugin memory' /></MetricPanel>
      <MetricPanel title='Operations by plugin' state={{ kind: 'data', updating, completeness }}><RankedBars items={items(row => row.operations)} unit={count} limit={8} label='Plugin operations' /></MetricPanel>
      <MetricPanel title='Mean resource latency' state={{ kind: 'data', updating, completeness }}><RankedBars items={items(row => row.latencyMs)} unit={millis} limit={8} label='Plugin latency' /></MetricPanel>
    </div>
    <Table.Container><Table size='sm' aria-label='Plugin measurements'><Table.Head><Table.Row><Table.HeaderCell>Plugin</Table.HeaderCell><Table.HeaderCell>CPU</Table.HeaderCell><Table.HeaderCell>Memory</Table.HeaderCell><Table.HeaderCell>Operations</Table.HeaderCell><Table.HeaderCell>Latency</Table.HeaderCell><Table.HeaderCell>Health</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{rows.map(row => <Table.Row key={row.id}>
      <Table.Cell>{row.id}</Table.Cell>
      <Table.Cell>{row.cpu === null ? '—' : <MetricValue value={row.cpu} unit={cores} size='sm' />}</Table.Cell>
      <Table.Cell>{row.memory === null ? '—' : <MetricValue value={row.memory} unit={bytes} size='sm' />}</Table.Cell>
      <Table.Cell><MetricValue value={row.operations} unit={count} size='sm' /></Table.Cell>
      <Table.Cell>{row.latencyMs === null ? '—' : <MetricValue value={row.latencyMs} unit={millis} size='sm' />}</Table.Cell>
      <Table.Cell>{row.errors > 0 && <Chip size='sm' color='danger'>{row.errors} failed</Chip>} {row.crashes > 0 && <Chip size='sm' color='warning'>{row.crashes} crashes</Chip>}</Table.Cell>
    </Table.Row>)}</Table.Body></Table></Table.Container>
  </div>;
}
