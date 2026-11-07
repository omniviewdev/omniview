import { useRef, useState } from 'react';
import { Banner, Button, Chip, Heading, Input, Pagination, Select, Table, Text } from '@omniviewdev/base-ui';
import { MetricValue } from '@omniviewdev/base-ui/metrics';
import { Diagnostics } from '@omniviewdev/runtime/api';
import type { Capture, CaptureSummary, Comparison } from './model';
import { comparisonSuffix, comparisonUnit } from './model';
import { MetricGrid } from './MetricGrid';
import styles from './Performance.module.css';

function CaptureSelect({ label, value, captures, onChange, disabled }: { label: string; value: string; captures: CaptureSummary[]; onChange: (value: string) => void; disabled: boolean }) {
  return <Select size='sm' disabled={disabled} value={value} onValueChange={next => {
    onChange(next ?? ''); 
  }}><Select.Trigger aria-label={label}><Select.Value placeholder={label} /><Select.Icon /></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup><Select.List>{captures.map(capture => <Select.Item key={capture.id} value={capture.id}>{capture.name} · {capture.status}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal></Select>;
}

export function Captures({ captures, refresh, maxSeconds }: { captures: CaptureSummary[]; refresh: () => Promise<void>; maxSeconds?: number }) {
  const [name, setName] = useState('');
  const [workload, setWorkload] = useState('');
  const [duration, setDuration] = useState('60');
  const [baseline, setBaseline] = useState('');
  const [candidate, setCandidate] = useState('');
  const [selected, setSelected] = useState<Capture | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comparisonPage, setComparisonPage] = useState(1);
  const [capturePage, setCapturePage] = useState(1);
  const comparisonMetrics = comparison?.metrics ?? [];
  const comparisonPages = Math.max(1, Math.ceil(comparisonMetrics.length / 80));
  const currentComparisonPage = Math.min(comparisonPage, comparisonPages);
  const captureMetrics = selected?.samples?.at(-1)?.metrics ?? [];
  const capturePages = Math.max(1, Math.ceil(captureMetrics.length / 24));
  const currentCapturePage = Math.min(capturePage, capturePages);
  const request = useRef(0);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try {
      await action(); await refresh(); 
    } catch (cause) {
      setError(String(cause)); 
    } finally {
      setBusy(false); 
    }
  }

  function selectCapture(id: string) {
    const serial = ++request.current;
    if (id !== selected?.id) {
      setCapturePage(1);
    }

    void run(async () => {
      const capture = await Diagnostics.GetCapture(id); if (serial === request.current) {
        setSelected(capture); setComparison(null); 
      } 
    });
  }

  return <div className={styles.Captures}>
    <section className={styles.Form} aria-label='Start diagnostic capture'>
      <label>Name<Input size='sm'><Input.Control value={name} onChange={event => {
        setName(event.target.value); 
      }} placeholder='Baseline before change' maxLength={80} /></Input></label>
      <label>Workload<Input size='sm'><Input.Control value={workload} onChange={event => {
        setWorkload(event.target.value); 
      }} placeholder='Same workload for comparison' maxLength={120} /></Input></label>
      <label>Seconds{maxSeconds ? ` (1–${maxSeconds})` : ''}<Input size='sm'><Input.Control value={duration} onChange={event => {
        setDuration(event.target.value); 
      }} inputMode='numeric' aria-label='Capture duration seconds' /></Input></label>
      <Button size='sm' disabled={busy || !maxSeconds || !name.trim() || !Number.isInteger(Number(duration)) || Number(duration) <= 0 || Number(duration) > maxSeconds} onClick={() => {
        void run(async () => {
          const capture = await Diagnostics.StartCapture({ name: name.trim(), workload: workload.trim(), durationSeconds: Number(duration) }); setSelected(capture); setComparison(null); setCapturePage(1);
        }); 
      }}>Start capture</Button>
    </section>
    {error && <Banner color='danger' size='sm'>{error}</Banner>}
    <Table.Container><Table size='sm' stickyHeader aria-label='Diagnostic captures'><Table.Head><Table.Row><Table.HeaderCell>Capture</Table.HeaderCell><Table.HeaderCell>Revision / workload</Table.HeaderCell><Table.HeaderCell>State</Table.HeaderCell><Table.HeaderCell>Elapsed</Table.HeaderCell><Table.HeaderCell>Actions</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{captures.map(capture => <Table.Row key={capture.id} selected={selected?.id === capture.id}><Table.Cell><Button size='sm' variant='ghost' disabled={busy} onClick={() => {
      selectCapture(capture.id); 
    }}>{capture.name}</Button><small className={styles.Muted}>{new Date(capture.startedAt).toLocaleString()}</small></Table.Cell><Table.Cell>{capture.identity.revision === '' ? capture.identity.version : capture.identity.revision}<small className={styles.Muted}>{capture.workload === '' ? 'Workload not specified' : capture.workload}</small></Table.Cell><Table.Cell><Chip size='sm' color={capture.status === 'complete' ? 'success' : 'neutral'}>{capture.status}</Chip></Table.Cell><Table.Cell>{capture.elapsedSeconds.toFixed(1)} / {capture.durationSeconds}s</Table.Cell><Table.Cell>{capture.status === 'running' && <Button size='sm' variant='outline' disabled={busy} onClick={() => {
      void run(async () => {
        const canceled = await Diagnostics.CancelCapture(capture.id); if (selected?.id === capture.id) {
          setSelected(canceled);
        } 
      }); 
    }}>Cancel</Button>}</Table.Cell></Table.Row>)}</Table.Body></Table></Table.Container>
    {!captures.length && <Banner size='sm'>No saved captures. Record the same workload before and after a change.</Banner>}
    <section className={styles.Compare} aria-label='Compare captures'>
      <CaptureSelect label='Baseline capture' value={baseline} captures={captures} disabled={busy} onChange={value => {
        setBaseline(value); setComparison(null); setComparisonPage(1);
      }} />
      <CaptureSelect label='Candidate capture' value={candidate} captures={captures} disabled={busy} onChange={value => {
        setCandidate(value); setComparison(null); setComparisonPage(1);
      }} />
      <Button size='sm' disabled={busy || !baseline || !candidate || baseline === candidate} onClick={() => {
        void run(async () => {
          setComparison(await Diagnostics.CompareCaptures(baseline, candidate)); setSelected(null); setComparisonPage(1);
        }); 
      }}>Compare captures</Button>
    </section>
    {comparison && <section aria-label='Capture comparison'>
      <Heading size='sm'>{comparison.compatible ? 'Capture comparison' : 'Incompatible captures'}</Heading>
      {(comparison.warnings ?? []).map((warning, index) => <Banner key={index} color='warning' size='sm'>{warning}</Banner>)}
      <Table size='sm' aria-label='Compared measurements'><Table.Head><Table.Row><Table.HeaderCell>Measurement / semantics</Table.HeaderCell><Table.HeaderCell>Baseline</Table.HeaderCell><Table.HeaderCell>Candidate</Table.HeaderCell><Table.HeaderCell>Change</Table.HeaderCell></Table.Row></Table.Head><Table.Body>{comparisonMetrics.slice((currentComparisonPage - 1) * 80, currentComparisonPage * 80).map((metric, index) => {
        const unit = comparisonUnit(metric.unit, metric.kind, metric.name);
        const usable = metric.valid && comparison.compatible && unit;
        return <Table.Row key={`${metric.name}:${index}`}><Table.Cell>{metric.name}<small className={styles.Muted}>{metric.semantics}{metric.warning ? ` · ${metric.warning}` : ''}{Object.keys(metric.attributes ?? {}).length ? ` · ${Object.entries(metric.attributes).map(([key, value]) => `${key}: ${value}`).join(', ')}` : ''}</small></Table.Cell>{[metric.baseline, metric.candidate, metric.delta].map((value, column) => <Table.Cell key={column}>{usable ? <><MetricValue value={Number.isFinite(value) ? value : null} unit={unit} size='sm' />{comparisonSuffix(metric.unit, metric.kind, metric.name)}</> : 'Unavailable'}</Table.Cell>)}</Table.Row>;
      })}</Table.Body></Table>
      <div className={styles.Filter}><Text size='sm' tone='muted'>{comparisonMetrics.length} compared measurements · page {currentComparisonPage} of {comparisonPages}</Text>{comparisonPages > 1 && <Pagination size='sm' aria-label='Comparison pages' count={comparisonPages} page={currentComparisonPage} onChange={setComparisonPage} />}</div>
      {!comparison.metrics?.length && <Banner size='sm'>No comparable measurements.</Banner>}
    </section>}
    {selected && <section aria-label='Saved capture details'><div className={styles.Heading}><Heading size='sm'>{selected.name}</Heading><Chip size='sm'>{selected.status}</Chip><Button size='sm' variant='ghost' disabled={busy} onClick={() => {
      selectCapture(selected.id); 
    }}>Reload capture</Button></div>
    <p className={styles.Muted}>{selected.samples?.length ?? 0} samples · {selected.elapsedSeconds.toFixed(1)}s · {selected.coverage.gaps} gaps · {selected.coverage.dropped} dropped{!selected.coverage.complete ? ' · incomplete coverage' : ''}</p>
    {selected.error && <Banner color='warning' size='sm'>{selected.error}</Banner>}
    <MetricGrid metrics={captureMetrics.slice((currentCapturePage - 1) * 24, currentCapturePage * 24)} samples={selected.samples ?? []} updating={false} health={selected.coverage} />
    <div className={styles.Filter}><Text size='sm' tone='muted'>{captureMetrics.length} measurements · page {currentCapturePage} of {capturePages}</Text>{capturePages > 1 && <Pagination size='sm' aria-label='Saved capture measurement pages' count={capturePages} page={currentCapturePage} onChange={setCapturePage} />}</div>
    {!selected.samples?.length && <Banner size='sm'>No samples retained for this capture.</Banner>}
    </section>}
  </div>;
}
