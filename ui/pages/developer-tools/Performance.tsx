import { useState } from 'react';
import { Banner, Breadcrumbs, Button, Chip, EmptyState, SearchInput, Tabs, Text, Toolbar } from '@omniviewdev/base-ui';
import { useNavigate, useSearchParams } from 'react-router';
import { MetricPanel } from '@omniviewdev/base-ui/metrics';
import HintTooltip from '@/components/base/HintTooltip';
import { useDiagnostics } from '@/features/diagnostics/useDiagnostics';
import { MetricGrid } from '@/features/diagnostics/MetricGrid';
import { Captures } from '@/features/diagnostics/Captures';
import { Operations } from '@/features/diagnostics/Operations';
import { Overview } from '@/features/diagnostics/Overview';
import { Pipeline } from '@/features/diagnostics/Pipeline';
import styles from '@/features/diagnostics/Performance.module.css';

const views = ['overview', 'operations', 'pipeline', 'captures', 'all'] as const;
const labels = { overview: 'Overview', operations: 'Operations', pipeline: 'Metrics pipeline', captures: 'Captures', all: 'All measurements' };
const pageSize = 12;

export default function Performance() {
  const diagnostics = useDiagnostics();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view = views.find(value => value === requested) ?? 'overview';
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const currentMetrics = diagnostics.latest?.metrics ?? [];
  const metrics = [...currentMetrics, ...(diagnostics.catalog?.metrics ?? []).filter(metric => !currentMetrics.some(current => current.name === metric.name)).map(metric => ({ ...metric, points: [] }))];
  const operations = metrics.filter(metric => /^omniview\.(resource|operation|plugin)\.|^rpc\./.test(metric.name));
  const visible = metrics.filter(metric => `${metric.name} ${metric.description}`.toLowerCase().includes(query.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  const health = diagnostics.health;
  const status = diagnostics.error ? 'Collection error' : health && !health.complete ? 'Degraded' : diagnostics.latest && health ? 'Live' : 'Connecting';
  const identity = diagnostics.latest?.identity;
  const details = [
    health ? `${health.gaps} gaps · ${health.dropped} dropped · ${health.errors} errors` : '',
    identity ? `${identity.version} · ${identity.revision === '' ? 'no commit' : identity.revision} · source ${identity.sourceState === '' ? 'unknown' : identity.sourceState}` : '',
    `${diagnostics.samples.length} samples`,
  ].filter(part => part !== '').join(' — ');
  const ready = diagnostics.latest !== undefined;
  return <main className={styles.Page} aria-label='Application performance'>
    <Toolbar size='sm' className={styles.Toolbar}><Toolbar.Group><Breadcrumbs size='sm'><Breadcrumbs.Item>Developer Tools</Breadcrumbs.Item><Breadcrumbs.Item active>Performance</Breadcrumbs.Item></Breadcrumbs><HintTooltip content={details}><span tabIndex={0}><Chip size='sm' color={diagnostics.error ? 'danger' : health ? health.complete ? 'success' : 'warning' : 'neutral'}>{status}</Chip></span></HintTooltip></Toolbar.Group><Toolbar.Group><Button size='sm' variant='ghost' onClick={() => {
      void navigate('/developer-tools/extensions');
    }}>Extension Inspector</Button><Button size='sm' variant='outline' disabled={diagnostics.updating} onClick={() => {
      void diagnostics.refresh();
    }}>Refresh</Button></Toolbar.Group></Toolbar>
    {diagnostics.error && <Banner size='sm' color='danger'>{diagnostics.error}{ready ? ' · Showing last collected samples.' : ''}</Banner>}
    {health && !health.complete && health.lastError !== '' && <Banner size='sm' color='warning'>{health.lastError}</Banner>}
    <Tabs variant='flat' size='sm' value={view} onValueChange={value => {
      const next = new URLSearchParams(params); next.set('view', String(value)); setParams(next); setPage(0);
    }}>
      <Tabs.List aria-label='Performance views'>{views.map(value => <Tabs.Tab key={value} value={value}>{labels[value]}</Tabs.Tab>)}<Tabs.Indicator /></Tabs.List>
    </Tabs>
    <div className={styles.Content}>{view === 'captures' ? <Captures captures={diagnostics.captures} refresh={diagnostics.refresh} maxSeconds={diagnostics.catalog?.limits.captureSeconds} /> : !ready ? <MetricPanel title='Measurements' loadingChart state={diagnostics.error ? { kind: 'error', message: diagnostics.error } : { kind: 'initial', message: 'Collecting…' }} /> : view === 'overview' ? <Overview samples={diagnostics.samples} updating={diagnostics.updating} health={health} /> : view === 'operations' ? <Operations metrics={operations} samples={diagnostics.samples} updating={diagnostics.updating} health={health} /> : view === 'pipeline' ? <Pipeline samples={diagnostics.samples} updating={diagnostics.updating} health={health} /> : <>
      <div className={styles.Filter}><SearchInput size='sm' aria-label='Filter performance measurements' placeholder='Filter measurements…' value={query} onValueChange={value => {
        setQuery(value); setPage(0);
      }} /><Text size='sm' tone='muted'>{visible.length} measurements</Text></div>
      {visible.length === 0 ? <EmptyState size='sm' title='No matching measurements' /> : <MetricGrid metrics={visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize)} samples={diagnostics.samples} updating={diagnostics.updating} health={health} />}
      {visible.length > pageSize && <div className={styles.Filter}><Button size='sm' variant='ghost' disabled={currentPage === 0} onClick={() => {
        setPage(currentPage - 1);
      }}>Previous</Button><Text size='sm'>{currentPage + 1} / {Math.ceil(visible.length / pageSize)}</Text><Button size='sm' variant='ghost' disabled={(currentPage + 1) * pageSize >= visible.length} onClick={() => {
        setPage(currentPage + 1);
      }}>Next</Button></div>}
    </>}</div>
  </main>;
}
