import { useState } from 'react';
import { Button, Chip, EmptyState, Table, Text } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, RankedBars } from '@omniviewdev/base-ui/metrics';
import type { Metric, Snapshot } from './model';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import { dimensionLabel, metricTitle } from './display';
import { metricUnit, pointKey } from './model';
import { MetricGrid } from './MetricGrid';
import styles from './Performance.module.css';

const pageSize = 12;

function outcomeColor(attributes: Readonly<Record<string, string | undefined>> | undefined) {
  const outcome = attributes?.outcome;
  if (outcome === 'success') {
    return 'success' as const;
  }

  return outcome === 'error' || outcome === 'timeout' ? 'danger' as const : 'neutral' as const;
}

export function Operations({ metrics, samples, updating, health }: { metrics: Metric[]; samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState('');
  const rows = metrics.flatMap(metric => (metric.points ?? []).map(point => ({ metric, point, id: `${metric.name}:${pointKey(point.attributes)}` })));
  const calls = rows.filter(row => row.metric.name === 'omniview.operation.calls');
  const latencies = rows.filter(row => row.metric.kind === 'histogram' && row.metric.unit === 'ms' && row.point.count > 0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const selected = rows.find(row => row.id === selection);
  const completeness = health ? health.complete ? 'complete' as const : 'partial' as const : 'unknown' as const;
  if (rows.length === 0) {
    return <EmptyState size='sm' title='No operations observed yet' />;
  }

  return <section className={styles.Dashboard} aria-label='Operation measurements'>
    <div className={styles.Charts}>
      {calls.length > 0 && <MetricPanel title='Operations by outcome' state={{ kind: 'data', updating, completeness }}>
        <RankedBars items={calls.map(row => ({ id: row.id, label: dimensionLabel(row.point.attributes), value: row.point.value }))} unit={{ kind: 'count' }} limit={6} label='Operation calls' />
      </MetricPanel>}
      {latencies.length > 0 && <MetricPanel title='Mean latency' state={{ kind: 'data', updating, completeness }}>
        <RankedBars items={latencies.map(row => ({ id: row.id, label: `${metricTitle(row.metric.name)} ${dimensionLabel(row.point.attributes)}`.trim(), value: row.point.sum / row.point.count }))} unit={{ kind: 'duration', base: 'milliseconds' }} limit={6} selectedId={selection} onSelect={setSelection} label='Mean latency' />
      </MetricPanel>}
    </div>
    <Table.Container><Table size='sm' stickyHeader hoverable aria-label='Operation series'><Table.Head><Table.Row><Table.HeaderCell>Measurement</Table.HeaderCell><Table.HeaderCell>Dimensions</Table.HeaderCell><Table.HeaderCell>Count / value</Table.HeaderCell><Table.HeaderCell>Mean</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(({ metric, point, id }) => {
      const unit = metricUnit(metric.unit);
      const histogram = metric.kind === 'histogram';
      return <Table.Row key={id} selected={id === selection}><Table.Cell><Button size='sm' variant='ghost' onClick={() => {
        setSelection(id);
      }}>{metricTitle(metric.name)}</Button></Table.Cell><Table.Cell>{Object.entries(point.attributes ?? {}).map(([key, value]) => <Chip key={key} size='sm' color={key === 'outcome' ? outcomeColor(point.attributes) : 'neutral'}>{value}</Chip>)}</Table.Cell><Table.Cell>{histogram ? <MetricValue value={point.count} unit={{ kind: 'count' }} size='sm' /> : unit ? <MetricValue value={point.value} unit={unit} size='sm' /> : '—'}</Table.Cell><Table.Cell>{histogram && unit ? <MetricValue value={point.count > 0 ? point.sum / point.count : null} unit={unit} size='sm' /> : '—'}</Table.Cell></Table.Row>;
    })}</Table.Body></Table></Table.Container>
    {rows.length > pageSize && <div className={styles.Filter}><Text size='sm' tone='muted'>{rows.length} series</Text><div><Button size='sm' variant='ghost' disabled={currentPage === 0} onClick={() => {
      setPage(currentPage - 1);
    }}>Previous</Button><Text size='sm'>{currentPage + 1} / {Math.ceil(rows.length / pageSize)}</Text><Button size='sm' variant='ghost' disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => {
      setPage(currentPage + 1);
    }}>Next</Button></div></div>}
    {selected && <MetricGrid metrics={[{ ...selected.metric, points: [selected.point] }]} samples={samples} updating={updating} health={health} />}
  </section>;
}
