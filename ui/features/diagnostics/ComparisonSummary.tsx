import { useState } from 'react';
import { Button, Chip, Collapsible, CollapsibleContent, CollapsibleTrigger, Pagination, Table, Text } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, RankedBars } from '@omniviewdev/base-ui/metrics';
import type { MetricUnit } from '@omniviewdev/base-ui/metrics';
import { comparisonArea, dimensionLabel, metricTitle } from './display';
import { comparisonSuffix, comparisonUnit } from './model';
import type { Comparison } from './model';
import styles from './Performance.module.css';

const pageSize = 40;
const threshold = 10;

function chipsFor(warnings: readonly string[]): string[] {
  return warnings.map(warning => {
    if (warning.includes('sessions differ')) {
      return 'Different sessions';
    }

    if (warning.includes('source state')) {
      return 'Source unverified';
    }

    if (warning.includes('incomplete')) {
      return 'Incomplete coverage';
    }

    return warning;
  });
}

export function ComparisonSummary({ comparison }: { comparison: Comparison }) {
  const [page, setPage] = useState(1);
  const metrics = comparison.metrics ?? [];
  const usable = metrics.filter(metric => metric.valid && comparison.compatible && comparisonUnit(metric.unit, metric.kind, metric.name) !== null);
  const changes = usable
    .filter(metric => metric.baseline > 0 && Number.isFinite(metric.delta))
    .map(metric => ({ metric, percent: (metric.delta / metric.baseline) * 100 }))
    .filter(change => Math.abs(change.percent) >= threshold)
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
  const areas = [...new Set(changes.map(change => comparisonArea(change.metric.name)))];
  const pages = Math.max(1, Math.ceil(metrics.length / pageSize));
  const current = Math.min(page, pages);
  const warnings = chipsFor(comparison.warnings ?? []);
  const percent: MetricUnit = { kind: 'percent' };
  return <section className={styles.Dashboard} aria-label='Capture comparison'>
    <div className={styles.Chips}>
      <Chip size='sm' color={comparison.compatible ? 'success' : 'warning'}>{comparison.compatible ? 'Comparable' : 'Not comparable'}</Chip>
      {warnings.map(label => <Chip key={label} size='sm' color='warning'>{label}</Chip>)}
      {comparison.compatible && <Chip size='sm' color='neutral'>{usable.length} measured · {changes.length} changed ≥{threshold}%</Chip>}
    </div>
    {changes.length > 0 && <div className={styles.Charts}>
      {areas.map(area => <MetricPanel key={area} title={area} state={{ kind: 'data', updating: false, completeness: 'complete' }}>
        <RankedBars items={changes.filter(change => comparisonArea(change.metric.name) === area).map(change => ({ id: `${change.metric.name}:${dimensionLabel(change.metric.attributes)}`, label: `${change.percent > 0 ? '▲' : '▼'} ${metricTitle(change.metric.name)} ${dimensionLabel(change.metric.attributes)}`.trim(), value: Math.abs(change.percent) }))} unit={percent} limit={5} label={`${area} changes`} />
      </MetricPanel>)}
    </div>}
    {comparison.compatible && changes.length === 0 && <Text size='sm' tone='muted'>No measurement changed by {threshold}% or more.</Text>}
    <Collapsible>
      <CollapsibleTrigger>All measurements ({metrics.length})</CollapsibleTrigger>
      <CollapsibleContent>
        <Table size='sm' aria-label='Compared measurements'><Table.Head><Table.Row><Table.HeaderCell>Measurement</Table.HeaderCell><Table.HeaderCell>Baseline</Table.HeaderCell><Table.HeaderCell>Candidate</Table.HeaderCell><Table.HeaderCell>Change</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{metrics.slice((current - 1) * pageSize, current * pageSize).map((metric, index) => {
          const unit = comparisonUnit(metric.unit, metric.kind, metric.name);
          const show = metric.valid && comparison.compatible && unit !== null;
          return <Table.Row key={`${metric.name}:${index}`}><Table.Cell>{metricTitle(metric.name)} <Text size='sm' tone='muted'>{dimensionLabel(metric.attributes)}</Text></Table.Cell>{[metric.baseline, metric.candidate, metric.delta].map((value, column) => <Table.Cell key={column}>{show ? <><MetricValue value={Number.isFinite(value) ? value : null} unit={unit} size='sm' />{comparisonSuffix(metric.unit, metric.kind, metric.name)}</> : '—'}</Table.Cell>)}</Table.Row>;
        })}</Table.Body></Table>
        {pages > 1 && <div className={styles.Filter}><Text size='sm' tone='muted'>{metrics.length} measurements</Text><Pagination size='sm' aria-label='Comparison pages' count={pages} page={current} onChange={setPage} /></div>}
      </CollapsibleContent>
    </Collapsible>
    {metrics.length === 0 && <Button size='sm' variant='ghost' disabled>No comparable measurements</Button>}
  </section>;
}
