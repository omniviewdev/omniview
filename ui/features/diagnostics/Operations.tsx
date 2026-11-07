import { useState } from 'react';
import { Button, Table, Text } from '@omniviewdev/base-ui';
import { MetricValue } from '@omniviewdev/base-ui/metrics';
import type { Metric, Snapshot } from './model';
import type { DiagnosticsHealth } from '@omniviewdev/runtime/api';
import { metricUnit, pointKey } from './model';
import { MetricGrid } from './MetricGrid';
import styles from './Performance.module.css';

export function Operations({ metrics, samples, updating, health }: { metrics: Metric[]; samples: Snapshot[]; updating: boolean; health: DiagnosticsHealth | undefined }) {
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState('');
  const rows = metrics.flatMap(metric => (metric.points ?? []).map(point => ({ metric, point, id: `${metric.name}:${pointKey(point.attributes)}` })));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 60) - 1));
  const selected = rows.find(row => row.id === selection);
  return <section aria-label='Operation measurements'>
    <Table.Container><Table size='sm' stickyHeader hoverable aria-label='Operation series'><Table.Head><Table.Row><Table.HeaderCell>Measurement</Table.HeaderCell><Table.HeaderCell>Dimensions</Table.HeaderCell><Table.HeaderCell>Observations / current</Table.HeaderCell><Table.HeaderCell>Mean latency / size</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{rows.slice(currentPage * 60, (currentPage + 1) * 60).map(({ metric, point, id }) => {
      const unit = metricUnit(metric.unit);
      const histogram = metric.kind === 'histogram';
      return <Table.Row key={id} selected={id === selection}><Table.Cell><Button size='sm' variant='ghost' onClick={() => {
        setSelection(id); 
      }}>{metric.description === '' ? metric.name : metric.description}</Button><Text as='div' size='sm' tone='muted'>{metric.name}</Text></Table.Cell><Table.Cell><Text size='sm'>{Object.entries(point.attributes ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'}</Text></Table.Cell><Table.Cell>{histogram ? <MetricValue value={point.count} unit={{ kind: 'count' }} size='sm' /> : unit ? <MetricValue value={point.value} unit={unit} size='sm' /> : 'Unavailable'}</Table.Cell><Table.Cell>{histogram && unit ? <MetricValue value={point.count > 0 ? point.sum / point.count : null} unit={unit} size='sm' /> : '—'}</Table.Cell></Table.Row>;
    })}</Table.Body></Table></Table.Container>
    <div className={styles.Filter}><Text size='sm' tone='muted'>{rows.length} series · cumulative observations and totals</Text><div><Button size='sm' variant='ghost' disabled={currentPage === 0} onClick={() => {
      setPage(currentPage - 1); 
    }}>Previous</Button><Text size='sm'>{currentPage + 1} / {Math.max(1, Math.ceil(rows.length / 60))}</Text><Button size='sm' variant='ghost' disabled={(currentPage + 1) * 60 >= rows.length} onClick={() => {
      setPage(currentPage + 1); 
    }}>Next</Button></div></div>
    {!rows.length && <Text size='sm' tone='muted'>No operation series observed.</Text>}
    {selected && <><Text as='p' size='sm' tone='muted'>{Object.entries(selected.point.attributes ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'All observations'}</Text><MetricGrid metrics={[{ ...selected.metric, points: [selected.point] }]} samples={samples} updating={updating} health={health} /></>}
  </section>;
}
