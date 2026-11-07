import { useState } from 'react';
import { Banner, Breadcrumbs, Button, Chip, SearchInput, Select, Tabs, Text, Toolbar } from '@omniviewdev/base-ui';
import { useNavigate, useSearchParams } from 'react-router';
import { MetricPanel } from '@omniviewdev/base-ui/metrics';
import { useDiagnostics } from '@/features/diagnostics/useDiagnostics';
import { MetricGrid } from '@/features/diagnostics/MetricGrid';
import { Captures } from '@/features/diagnostics/Captures';
import { Operations } from '@/features/diagnostics/Operations';
import styles from '@/features/diagnostics/Performance.module.css';

const views = ['overview', 'operations', 'pipeline', 'captures'] as const;
const labels = { overview: 'Overview', operations: 'Operations', pipeline: 'Metrics pipeline', captures: 'Captures / comparison' };
const overviewOrder = [
  'omniview.process.cpu_time',
  'omniview.process.go_heap_bytes',
  'omniview.process.goroutines',
  'omniview.process.memory_peak_rss',
  'omniview.plugin.active',
  'omniview.resource.watches_active',
];
export default function Performance() {
  const diagnostics = useDiagnostics();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view = views.find(value => value === requested) ?? 'overview';
  const [query, setQuery] = useState('');
  const [allMeasurements, setAllMeasurements] = useState(false);
  const [page, setPage] = useState(0);
  const currentMetrics = diagnostics.latest?.metrics ?? [];
  const metrics = [...currentMetrics, ...(diagnostics.catalog?.metrics ?? []).filter(metric => !currentMetrics.some(current => current.name === metric.name)).map(metric => ({ ...metric, points: [] }))];
  const groups = {
    overview: overviewOrder.flatMap(name => metrics.filter(metric => metric.name === name)),
    operations: metrics.filter(metric => /resource\.|plugin\.|wails\./.test(metric.name)),
    pipeline: metrics.filter(metric => /metric|pipeline|queue|cache|provider|cancel|scan|collect|export/.test(metric.name)),
  };
  const visible = (allMeasurements ? metrics : view === 'captures' ? [] : groups[view]).filter(metric => `${metric.name} ${metric.description}`.toLowerCase().includes(query.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 24) - 1));
  const health = diagnostics.health;
  return <main className={styles.Page} aria-label='Application performance'>
    <Toolbar size='sm' className={styles.Toolbar}><Toolbar.Group><Breadcrumbs size='sm'><Breadcrumbs.Item>Developer Tools</Breadcrumbs.Item><Breadcrumbs.Item active>Performance</Breadcrumbs.Item></Breadcrumbs><Chip size='sm' color={diagnostics.error ? 'danger' : health ? health.complete ? 'success' : 'warning' : 'neutral'}>{diagnostics.error ? 'Collection error' : health && !health.complete ? 'Degraded' : diagnostics.latest && health ? 'Live' : 'Connecting'}</Chip></Toolbar.Group><Toolbar.Group><Button size='sm' variant='ghost' onClick={() => {
      void navigate('/developer-tools/extensions'); 
    }}>Extension Inspector</Button><Button size='sm' variant='outline' disabled={diagnostics.updating} onClick={() => {
      void diagnostics.refresh(); 
    }}>Refresh</Button></Toolbar.Group></Toolbar>
    <div className={styles.Metadata}><Text size='sm' tone='muted'>{diagnostics.latest ? `${diagnostics.latest.identity.version} · commit ${diagnostics.latest.identity.revision === '' ? 'unavailable' : diagnostics.latest.identity.revision} · source ${diagnostics.latest.identity.sourceState === '' ? 'unknown' : diagnostics.latest.identity.sourceState} · ${diagnostics.samples.length} samples` : 'Waiting for local measurements'}</Text>{health && <Text size='sm' tone='muted'>{health.gaps} gaps · {health.dropped} dropped · {health.errors} errors</Text>}</div>
    {diagnostics.error && <Banner size='sm' color='danger'>{diagnostics.error}{diagnostics.latest ? ' · Showing last collected samples.' : ''}</Banner>}
    {health && (!health.complete || health.lastError) && <Banner size='sm' color='warning'>{health.lastError === '' ? 'Collection coverage is incomplete. Gaps remain unknown.' : health.lastError}</Banner>}
    <Tabs variant='flat' size='sm' value={view} onValueChange={value => {
      const next = new URLSearchParams(params); next.set('view', String(value)); setParams(next); 
    }}>
      <Tabs.List aria-label='Performance views'>{views.map(value => <Tabs.Tab key={value} value={value}>{labels[value]}</Tabs.Tab>)}<Tabs.Indicator /></Tabs.List>
    </Tabs>
    <div className={styles.Content}>{view === 'captures' ? <Captures captures={diagnostics.captures} refresh={diagnostics.refresh} maxSeconds={diagnostics.catalog?.limits.captureSeconds} /> : <>
      <div className={styles.Filter}><SearchInput size='sm' aria-label='Filter performance measurements' placeholder='Filter measurements…' value={query} onValueChange={value => {
        setQuery(value); setPage(0); 
      }} /><div className={styles.Scope}><Select size='sm' value={allMeasurements ? 'all' : 'view'} onValueChange={value => {
        setAllMeasurements(value === 'all'); setPage(0); 
      }}><Select.Trigger aria-label='Measurement scope'><Select.Value>{value => value === 'all' ? 'All measurements' : 'Current view'}</Select.Value><Select.Icon /></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup><Select.List><Select.Item value='view'>Current view</Select.Item><Select.Item value='all'>All measurements</Select.Item></Select.List></Select.Popup></Select.Positioner></Select.Portal></Select></div><Text size='sm' tone='muted'>{visible.length} measurements</Text></div>
      {!diagnostics.latest ? <MetricPanel title='Local measurements' loadingChart state={diagnostics.error ? { kind: 'error', message: diagnostics.error } : { kind: 'initial', message: 'Collecting application measurements…' }} /> : visible.length ? view === 'operations' && !allMeasurements ? <Operations metrics={visible} samples={diagnostics.samples} updating={diagnostics.updating} health={health} /> : <><MetricGrid metrics={visible.slice(currentPage * 24, (currentPage + 1) * 24)} samples={diagnostics.samples} updating={diagnostics.updating} health={health} />{visible.length > 24 && <div className={styles.Filter}><Button size='sm' variant='ghost' disabled={currentPage === 0} onClick={() => {
        setPage(currentPage - 1); 
      }}>Previous</Button><Text size='sm'>{currentPage + 1} / {Math.ceil(visible.length / 24)}</Text><Button size='sm' variant='ghost' disabled={(currentPage + 1) * 24 >= visible.length} onClick={() => {
        setPage(currentPage + 1); 
      }}>Next</Button></div>}</> : <MetricPanel title={labels[view]} state={{ kind: 'empty', message: query ? 'No measurements match this filter.' : 'No measurements observed yet.' }} />}
    </>}</div>
  </main>;
}
