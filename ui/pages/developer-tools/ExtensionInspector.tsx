import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { Banner, Breadcrumbs, Button, Checkbox, Chip, CodeBlock, DescriptionList, Dialog, Input, ResizableSplitPane, SearchInput, Select, StatusDot, Table, Tabs, Toolbar, TreeList } from '@omniviewdev/base-ui';
import { useExtensionDiagnostics } from '@/features/extensions/diagnostics/useExtensionDiagnostics';
import { filterExtensionSnapshot } from '@/features/extensions/diagnostics/model';
import type { ExtensionDiagnosticSnapshot, DiagnosticLookupResult, DiagnosticProblem } from '@/features/extensions/diagnostics/types';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '@/features/extensions/sidebar/extensionPoint';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '@/features/extensions/drawer/extensionPoint';
import styles from './ExtensionInspector.module.css';
import { LuFolder, LuBox, LuPlug, LuTriangleAlert, LuCircleAlert } from 'react-icons/lu';

type Node = { key: string; label: string; pointId?: string; pluginId?: string; contributionId?: string; pendingId?: string; count?: number; issues?: number; children: Node[] };
function inventoryTree(snapshot: ExtensionDiagnosticSnapshot): Node[] {
  const roots: Node[] = [];
  for (const point of snapshot.points) {
    let children = roots;
    let path = '';
    for (const segment of point.id.split('/')) {
      path += `/${segment}`;
      const currentPath = path;
      let node = children.find(item => item.key === currentPath);
      if (!node) {
        node = { key: path, label: segment, children: [] }; children.push(node); 
      }

      if (path === `/${point.id}`) {
        node.pointId = point.id;
        node.count = point.contributions.length;
        node.issues = snapshot.problems.filter(problem => problem.pointId === point.id).length;
        node.children.push(...point.contributions.map(value => ({ key: JSON.stringify(['contribution', point.id, value.pluginId, value.id]), label: value.label || value.id, pointId: point.id, pluginId: value.pluginId, contributionId: value.id, issues: snapshot.problems.filter(problem => problem.pointId === point.id && problem.pluginId === value.pluginId && problem.contributionId === value.id).length, children: [] })));
      }

      children = node.children;
    }
  }

  if (snapshot.pending.length) {
    roots.push({ key: 'pending', label: `Pending targets (${snapshot.pending.length})`, children: snapshot.pending.map(value => ({ key: JSON.stringify(['pending', value.pointId, value.pluginId, value.id]), label: value.id, pointId: value.pointId, pluginId: value.pluginId, pendingId: value.id, issues: 1, children: [] })) });
  }

  return roots;
}

function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]); 
}

function problemGroups(problems: DiagnosticProblem[]) {
  const groups = new Map<string, DiagnosticProblem[]>();
  for (const problem of problems) {
    const key = JSON.stringify([problem.kind, problem.pluginId, problem.pointId, problem.contributionId, problem.boundary]);
    const records = groups.get(key);
    if (records) {
      records.push(problem);
    } else {
      groups.set(key, [problem]);
    }
  }

  return [...groups.entries()];
}

function problemColor(problem: DiagnosticProblem) {
  return problem.kind === 'pending-target' || problem.kind === 'dependency-warning' ? 'warning' as const : 'danger' as const;
}

function saveSnapshot(snapshot: ExtensionDiagnosticSnapshot) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'extension-diagnostics.json'; link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url); 
  }, 0);
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange); 
  };
}

function getCompactLayout() {
  return window.innerWidth <= 1150;
}

export default function ExtensionInspector() {
  const diagnostics = useExtensionDiagnostics();
  const compactLayout = useSyncExternalStore(subscribeViewport, getCompactLayout);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [paused, setPaused] = useState<ExtensionDiagnosticSnapshot | null>(null);
  const [selectedKey, setSelected] = useState<string | null>(() => {
    const initial = diagnostics.snapshot;
    const initialNodes = flatten(inventoryTree(initial));
    const requested = initialNodes.find(item => item.contributionId === params.get('contribution') && (!params.get('point') || item.pointId === params.get('point')) && (!params.get('plugin') || item.pluginId === params.get('plugin')))
      ?? initialNodes.find(item => item.pointId === params.get('point') && !item.contributionId);
    const initialFiltered = filterExtensionSnapshot(initial, { pluginId: params.get('plugin') ?? undefined });
    const firstPoint = initialFiltered.points.find(item => item.contributions.length) ?? initialFiltered.points[0];
    return requested?.key ?? (firstPoint ? `/${firstPoint.id}` : initialNodes.find(item => item.pendingId)?.key ?? null);
  });
  const [selectedProblemId, setSelectedProblem] = useState<string | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState(diagnostics.snapshot);
  const [expanded, setExpanded] = useState<ReadonlySet<string | number>>(() => {
    const initial = new Set<string | number>(['pending', '/omniview', '/omniview/resource']);
    const target = flatten(inventoryTree(diagnostics.snapshot)).find(item => item.key === selectedKey);
    if (target?.pointId) {
      const segments = target.pointId.split('/');
      segments.forEach((_, index) => initial.add(`/${segments.slice(0, index + 1).join('/')}`));
    }

    return initial;
  });
  const [tab, setTab] = useState<'registration' | 'context'>('registration');
  const [resourceKey, setResourceKey] = useState('');
  const [lookupPlugin, setLookupPlugin] = useState('');
  const [lookup, setLookup] = useState<DiagnosticLookupResult | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [sensitive, setSensitive] = useState<ExtensionDiagnosticSnapshot | null>(null);
  const [exportPreview, setExportPreview] = useState<ExtensionDiagnosticSnapshot | null>(null);
  const [recover, setRecover] = useState<{ id: string; snapshot: ExtensionDiagnosticSnapshot } | null>(null);
  const [recoveryError, setRecoveryError] = useState('');
  const [problemsOpen, setProblemsOpen] = useState(true);
  const recoveryFocus = useRef<HTMLButtonElement>(null);
  const inspectorFocus = useRef<HTMLElement>(null);
  const snapshot = paused ?? diagnostics.snapshot;
  const pluginId = params.get('plugin') ?? '';
  const filtered = useMemo(() => filterExtensionSnapshot(snapshot, { query, pluginId: pluginId || undefined, issuesOnly }), [snapshot, query, pluginId, issuesOnly]);
  const nodes = useMemo(() => inventoryTree(filtered), [filtered]);
  const allNodes = useMemo(() => flatten(inventoryTree(snapshot)), [snapshot]);
  const defaultNode = useMemo(() => {
    const requested = allNodes.find(item => item.contributionId === params.get('contribution') && (!params.get('point') || item.pointId === params.get('point')) && (!pluginId || item.pluginId === pluginId))
      ?? allNodes.find(item => item.pointId === params.get('point') && !item.contributionId);
    const first = filtered.points.find(item => item.contributions.length) ?? filtered.points[0];
    return requested ?? allNodes.find(item => item.pointId === first?.id && !item.contributionId)
      ?? allNodes.find(item => item.pendingId && filtered.pending.some(pending => pending.pointId === item.pointId && pending.pluginId === item.pluginId && pending.id === item.pendingId));
  }, [allNodes, filtered, params, pluginId]);
  const selected = selectedKey ?? (selectedProblemId === null ? defaultNode?.key ?? null : null);
  const selectedProblem = selectedProblemId ?? (selected === null ? filtered.problems[0]?.id ?? null : null);
  const node = allNodes.find(item => item.key === selected);
  const point = snapshot.points.find(item => item.id === node?.pointId);
  const contribution = point?.contributions.find(item => item.id === node?.contributionId && item.pluginId === node?.pluginId);
  const pending = snapshot.pending.find(item => item.id === node?.pendingId && item.pluginId === node?.pluginId && item.pointId === node?.pointId);
  const problemSelection = snapshot.problems.find(problem => problem.id === selectedProblem);
  const inspectorPluginId = contribution?.pluginId ?? pending?.pluginId ?? problemSelection?.pluginId;
  const inspectedPlugin = snapshot.plugins.find(plugin => plugin.id === inspectorPluginId);
  const problems = (sensitive?.capturedAt === snapshot.capturedAt ? sensitive : snapshot).problems.filter(item => {
    if (selectedProblem) {
      return !!problemSelection && item.kind === problemSelection.kind && item.pluginId === problemSelection.pluginId && item.pointId === problemSelection.pointId && item.contributionId === problemSelection.contributionId && item.boundary === problemSelection.boundary;
    }

    if (!item.pointId && !item.contributionId) {
      return item.pluginId === inspectorPluginId;
    }

    return contribution ? item.pointId === point?.id && item.pluginId === contribution.pluginId && item.contributionId === contribution.id : pending ? item.pointId === pending.pointId && item.pluginId === pending.pluginId && item.contributionId === pending.id : item.pointId === point?.id;
  });
  const visiblePoint = filtered.points.find(item => item.id === point?.id);
  const contextSupported = point?.id === RESOURCE_SIDEBAR_EXTENSION_POINT_ID || point?.id === RESOURCE_DRAWER_EXTENSION_POINT_ID;
  const select = useCallback((key: string) => {
    const target = allNodes.find(item => item.key === key);
    setSelected(key); setSelectedProblem(null); setSelectionSnapshot(snapshot); setSensitive(null); setLookup(null); setLookupError('');
    if (target?.pointId) {
      setExpanded(previous => {
        const next = new Set(previous);
        const segments = target.pointId!.split('/');
        segments.forEach((_, index) => next.add(`/${segments.slice(0, index + 1).join('/')}`));
        if (target.pendingId) {
          next.add('pending');
        }

        return next;
      });
    }
  }, [allNodes, snapshot]);
  const expandedKeys = useMemo(() => {
    if (query) {
      return new Set(flatten(nodes).map(item => item.key));
    }

    if (selectedKey !== null || !node?.pointId) {
      return expanded;
    }

    const next = new Set(expanded);
    const segments = node.pointId.split('/');
    segments.forEach((_, index) => next.add(`/${segments.slice(0, index + 1).join('/')}`));
    return next;
  }, [query, nodes, selectedKey, node, expanded]);
  const closeRecovery = () => {
    setRecover(null); requestAnimationFrame(() => (recoveryFocus.current ?? inspectorFocus.current)?.focus());
  };

  const tree = <section className={styles.Tree} aria-label='Extension inventory'>
    <div className={styles.Heading}>REGISTRY · {filtered.points.length} POINTS</div>
    <TreeList items={nodes} itemKey={item => item.key} getChildren={item => item.children} getTextValue={item => item.label}
      expandedKeys={expandedKeys} onExpandedKeysChange={setExpanded}
      selectedKeys={new Set(selected ? [selected] : [])} onSelectedKeysChange={keys => {
        const key = [...keys][0]; if (key !== undefined) {
          select(String(key));
        } 
      }}
      selectionMode='single' typeahead density='compact' estimatedItemSize={24}
      renderItem={(item, meta) => <TreeList.Item itemKey={item.key} textValue={item.label} title={item.pointId ?? item.label}>
        <TreeList.ItemIndent depth={meta.depth} />{meta.isBranch && <TreeList.ItemToggle />}<TreeList.ItemIcon>{item.pendingId ? <LuTriangleAlert /> : item.contributionId ? <LuPlug /> : item.pointId ? <LuBox /> : <LuFolder />}</TreeList.ItemIcon><TreeList.ItemLabel>{item.label}</TreeList.ItemLabel>{item.count !== undefined && <TreeList.ItemMeta>{item.count}</TreeList.ItemMeta>}{!!item.issues && <TreeList.ItemBadge color='warning'>! {item.issues}</TreeList.ItemBadge>}
      </TreeList.Item>}>
      <TreeList.Viewport />
    </TreeList>
    {!nodes.length && <p role='status'>No results match these filters.</p>}
  </section>;
  const center = <section className={styles.Center}>
    <Breadcrumbs size='sm' className={styles.Breadcrumbs} aria-label='Extension point path'>{(node?.pointId?.split('/') ?? ['Extensions']).map((segment, index, segments) => <Breadcrumbs.Item key={index} active={index === segments.length - 1}>{segment}</Breadcrumbs.Item>)}</Breadcrumbs>
    {selected && node && !flatten(nodes).some(item => item.key === selected) && <p role='status'>Selection is hidden by current filters.</p>}
    {selectedProblem ? <><h2>{problemSelection?.kind ?? 'Removed problem'}</h2><p>{problemSelection?.pluginId}</p><p>{problemSelection?.message ?? 'Selected evidence was removed.'}</p><p>Plugin phase: {inspectedPlugin?.phase ?? 'Not observed'}</p></> : selected && !node ? <p role='status'>Selected registration was removed. Select another item.</p> : pending ? <><h2>{pending.id}</h2><p>Target point is not registered: {pending.pointId}</p><p>This queued contribution is not registry inventory.</p></> : point ? <>
      <div className={styles.Pointbar}><strong>{point.id.split('/').at(-1)}</strong><Chip size='sm' variant='outline' color='neutral'>{point.mode}</Chip><span>Owner: {point.owner}</span><span>v{point.version}</span></div>
      <div className={styles.SectionHead}>Contributions <Chip size='sm' color='neutral'>{visiblePoint?.contributions.length ?? 0}</Chip><span>of {point.contributions.length} registrations</span></div>
      <Table.Container className={styles.TableScroll}>
        <Table size='sm' layout='fixed' hoverable stickyHeader aria-label='Registered contributions'>
          <Table.Head><Table.Row><Table.HeaderCell style={{ width: '42%' }}>Contribution</Table.HeaderCell><Table.HeaderCell>Plugin</Table.HeaderCell><Table.HeaderCell>Source</Table.HeaderCell><Table.HeaderCell>State</Table.HeaderCell></Table.Row></Table.Head>
          <Table.Body>{visiblePoint?.contributions.map(item => <Table.Row key={JSON.stringify([point.id, item.pluginId, item.id])} selected={item.id === contribution?.id && item.pluginId === contribution?.pluginId}>
            <Table.Cell><Button className={styles.RegistrationButton} size='sm' variant='ghost' color='neutral' onClick={() => {
              select(JSON.stringify(['contribution', point.id, item.pluginId, item.id])); 
            }}><span>{item.label || item.id}<small className={styles.ContributionId}>{item.id}</small></span></Button></Table.Cell>
            <Table.Cell truncate mono>{item.pluginId}</Table.Cell><Table.Cell truncate>{item.source}</Table.Cell><Table.Cell><Chip size='sm' variant='soft' color={item.status === 'quarantined' ? 'danger' : 'neutral'}>{item.status}</Chip></Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table>
      </Table.Container>
      {!visiblePoint?.contributions.length && <p role='status'>No contributions match these filters.</p>}
      {point.mode === 'single' && <p className={styles.InventoryNote}>Single-mode inventory lists every registration, not a confirmed render winner. Run context lookup to inspect matching selection.</p>}
      <Tabs className={styles.EditorTabs} variant='flat' size='sm' value={tab} onValueChange={value => {
        setTab(value as 'registration' | 'context'); 
      }}>
        <Tabs.List aria-label='Extension inspection views'><Tabs.Tab value='registration'>Registration</Tabs.Tab><Tabs.Tab value='context'>Context lookup</Tabs.Tab><Tabs.Indicator /></Tabs.List>
        <Tabs.Panel value='registration' className={styles.CodeViewport}><CodeBlock size='sm' language='json' lineNumbers copyable code={JSON.stringify(contribution ? { id: contribution.id, pluginId: contribution.pluginId, source: contribution.source, valueType: contribution.valueType, resourceKey: contribution.resourceKey, status: contribution.status } : { id: point.id, owner: point.owner, mode: point.mode, version: point.version }, null, 2)} /><p className={styles.InventoryNote}>Safe type descriptor only. Contribution values are never evaluated or serialized.</p></Tabs.Panel>
        <Tabs.Panel value='context' className={styles.Lookup}>
          <p>Explicit lookup may execute plugin matchers. It does not mount components.</p>
          <label>Plugin ID<Input size='sm'><Input.Control value={lookupPlugin} onChange={event => {
            setLookupPlugin(event.target.value); 
          }} placeholder={contribution?.pluginId ?? 'Plugin ID'} /></Input></label>
          <label>Resource key<Input size='sm'><Input.Control value={resourceKey} onChange={event => {
            setResourceKey(event.target.value); 
          }} placeholder={contribution?.resourceKey ?? 'group::version::kind'} /></Input></label>
          {!contextSupported && <p role='status'>Unsupported context type. Only builtin resource sidebar and drawer points have lookup adapters.</p>}
          <Button size='sm' disabled={!diagnostics.windowName || !!paused || !contextSupported} onClick={() => {
            try {
              setLookup(diagnostics.lookup({ pointId: point.id, pluginId: lookupPlugin.length > 0 ? lookupPlugin : contribution?.pluginId ?? pluginId, resourceKey: resourceKey.length > 0 ? resourceKey : contribution?.resourceKey ?? '' }, selectedKey === null ? snapshot : selectionSnapshot)); setLookupError('');
            } catch (error) {
              setLookup(null); setLookupError(error instanceof Error ? error.message : 'Lookup failed.'); 
            } 
          }}>Run lookup</Button>
          {paused && <p>Resume live updates before context lookup.</p>}
          {lookupError && <Banner size='sm' color='danger'>{lookupError}</Banner>}{lookup && <section aria-label='Context lookup results'><div className={styles.SectionHead}>{lookup.selected.length} selected · {lookup.inventoryCount} inventory registrations</div>{!lookup.selected.length && <p role='status'>No matching contribution.</p>}<DescriptionList size='sm'><DescriptionList.Item label='Resource'>{lookup.resourceKey}</DescriptionList.Item><DescriptionList.Item label='Plugin'>{lookup.pluginId}</DescriptionList.Item><DescriptionList.Item label='Captured'>{lookup.capturedAt}</DescriptionList.Item></DescriptionList>{lookup.selected.map(item => <div className={styles.LookupResult} key={JSON.stringify([item.pluginId, item.id])}><span>{item.id}<small className={styles.ContributionId}>{item.pluginId}</small></span><Chip size='sm' color={item.quarantined ? 'danger' : 'neutral'}>{item.quarantined ? 'Quarantined' : 'Selected'}</Chip></div>)}{lookup.coverage.map((text, index) => <p key={index}>{text}</p>)}</section>}
        </Tabs.Panel></Tabs>
    </> : <p>Select a point or contribution. Empty inventory does not prove runtime success.</p>}
  </section>;
  const latestProblem = problems.reduce<DiagnosticProblem | undefined>((latest, problem) => !latest || (problem.timestamp ?? 0) >= (latest.timestamp ?? 0) ? problem : latest, undefined);
  const inspector = <aside ref={inspectorFocus} tabIndex={-1} aria-label='Selected extension details' className={styles.Inspector}><div className={styles.Heading}>INSPECTOR</div><div className={styles.InspectBody}>
    <h2>{contribution?.label?.length ? contribution.label : contribution?.id ?? pending?.id ?? problemSelection?.kind ?? 'Registration details'}</h2>
    <div className={styles.LongId}>{contribution?.id ?? pending?.id ?? inspectorPluginId ?? point?.id}</div>
    <DescriptionList size='sm' className={styles.Metadata}>
      <DescriptionList.Item label='State'>{contribution ? <Chip size='sm' color={contribution.status === 'quarantined' ? 'danger' : 'neutral'}>{contribution.status}</Chip> : pending ? 'Pending target' : 'No contribution selected'}</DescriptionList.Item>
      <DescriptionList.Item label='Plugin'>{inspectorPluginId ?? '—'}</DescriptionList.Item>
      <DescriptionList.Item label='Lifecycle'>{inspectedPlugin?.phase ?? 'Not observed'}</DescriptionList.Item>
      <DescriptionList.Item label='Source'>{contribution?.source ?? pending?.source ?? '—'}</DescriptionList.Item>
      <DescriptionList.Item label='Value type'>{contribution?.valueType ?? 'Not observed'}</DescriptionList.Item>
      <DescriptionList.Item label='Render eligibility'>{pending ? 'Target not registered' : contribution?.status === 'quarantined' ? 'Excluded by quarantine' : 'Context-dependent; not observed passively'}</DescriptionList.Item>
      <DescriptionList.Item label='Captured crashes'>{contribution?.crashCount ?? 'Not observed'}</DescriptionList.Item>
      {contribution?.resourceKey && <DescriptionList.Item label='Resource key'>{contribution.resourceKey}</DescriptionList.Item>}
    </DescriptionList>
    {inspectedPlugin?.error && <Banner size='sm' color='danger'>{inspectedPlugin.error}</Banner>}
    {inspectedPlugin?.warnings.map((warning, index) => <Banner size='sm' color='warning' key={index}>{warning}</Banner>)}
    <h3>Captured evidence <span>({problems.length})</span></h3>
    {latestProblem ? <Banner size='sm' color={problemColor(latestProblem)}><Banner.Content><strong>{latestProblem.kind}</strong><p>{latestProblem.message}</p>{latestProblem.stack && <pre>{latestProblem.stack}</pre>}{latestProblem.componentStack && <pre>{latestProblem.componentStack}</pre>}</Banner.Content></Banner> : <p className={styles.Muted}>No captured exception for this selection.</p>}
    <details className={styles.History}><summary>Event history · {problems.length} retained records</summary>{problems.map(problem => <article key={problem.id}><strong>{problem.kind}</strong><div className={styles.LongId}>{problem.id}</div><p>{problem.timestamp === undefined ? 'Time not observed' : new Date(problem.timestamp).toISOString()}{problem.boundary ? ` · ${problem.boundary}` : ''}</p><p>{problem.message}</p>{problem.stack && <pre>{problem.stack}</pre>}{problem.componentStack && <pre>{problem.componentStack}</pre>}</article>)}</details>
    <div className={styles.Actions}><Button size='sm' variant='outline' color='neutral' disabled={!diagnostics.windowName || !!paused} onClick={() => {
      const captured = diagnostics.capture(true); setPaused(captured); setSensitive(captured);
    }}>Reveal sensitive exception text…</Button>
    {contribution?.status === 'quarantined' && <Button ref={recoveryFocus} size='sm' disabled={!diagnostics.windowName || !!paused} onClick={() => {
      setRecoveryError(''); setRecover({ id: contribution.id, snapshot: selectionSnapshot });
    }}>Re-enable…</Button>}</div>
    <p className={styles.Safety}>Exception text may contain credentials and resource data. Reveal captures and pauses current state. Resume before revealing another capture.</p>
    {paused && contribution?.status === 'quarantined' && <p>Resume live updates before recovery.</p>}
    <details className={styles.Coverage}><summary>Coverage and safety</summary><p>No captured crashes does not prove successful rendering. Values are never evaluated here.</p>{snapshot.coverage.map((text, index) => <p key={index}>{text}</p>)}</details>
  </div></aside>;
  const detail = <ResizableSplitPane reverse defaultSize={compactLayout ? 285 : 340} minSize={230} maxSize={compactLayout ? 285 : 600} handleLabel='Resize inspector'>{[center, inspector]}</ResizableSplitPane>;
  const groups = problemGroups(filtered.problems);
  const problemsPanel = <section className={styles.Problems} aria-label='Extension problems'>
    <div className={styles.Heading}><Button size='sm' variant='ghost' color='neutral' onClick={() => {
      setProblemsOpen(false); 
    }}>Collapse Problems</Button><span>{filtered.problems.length} events · {groups.length} groups</span><span className={styles.Muted}>Bounded session evidence</span></div>
    <Table size='sm' layout='fixed' hoverable stickyHeader aria-label='Captured problem groups'>
      <Table.Head><Table.Row><Table.HeaderCell style={{ width: '48%' }}>Problem / evidence</Table.HeaderCell><Table.HeaderCell style={{ width: '18%' }}>Plugin</Table.HeaderCell><Table.HeaderCell>Target</Table.HeaderCell><Table.HeaderCell style={{ width: 65 }}>Events</Table.HeaderCell></Table.Row></Table.Head>
      <Table.Body>{groups.map(([key, records]) => {
        const problem = records.reduce((latest, record) => (record.timestamp ?? 0) >= (latest.timestamp ?? 0) ? record : latest);
        const selectedGroup = records.some(record => record.id === selectedProblem) || (!!node && node.pointId === problem.pointId && (!problem.contributionId ? !node.contributionId && !node.pendingId : node.pluginId === problem.pluginId && (node.contributionId === problem.contributionId || node.pendingId === problem.contributionId)));
        return <Table.Row key={key} selected={selectedGroup}><Table.Cell>
          <Button size='sm' variant='ghost' color={problemColor(problem)} className={styles.ProblemButton} onClick={() => {
            const target = problem.pointId ? allNodes.find(item => item.pointId === problem.pointId && (!problem.contributionId ? !item.contributionId && !item.pendingId : item.pluginId === problem.pluginId && (item.contributionId === problem.contributionId || item.pendingId === problem.contributionId))) : undefined;
            if (target) {
              select(target.key);
            } else {
              setSelected(null); setSelectedProblem(problem.id); setSensitive(null); setLookup(null); setLookupError(''); 
            }
          }}>{problemColor(problem) === 'danger' ? <LuCircleAlert aria-hidden /> : <LuTriangleAlert aria-hidden />}<span>{problem.message}<small className={styles.ContributionId}>{problem.kind}</small></span></Button>
          {records.length > 1 && <details className={styles.GroupHistory}><summary>{records.length} retained events</summary>{records.map(record => <article key={record.id}><strong>{record.id}</strong><p>{record.timestamp === undefined ? 'Time not observed' : new Date(record.timestamp).toISOString()}</p><p>{record.message}</p>{record.boundary && <p>Boundary: {record.boundary}</p>}</article>)}</details>}
        </Table.Cell><Table.Cell mono truncate>{problem.pluginId}</Table.Cell><Table.Cell mono truncate title={problem.contributionId ?? problem.pointId}>{problem.contributionId ?? problem.pointId ?? 'Plugin lifecycle'}</Table.Cell><Table.Cell numeric>{records.length}</Table.Cell></Table.Row>;
      })}</Table.Body>
    </Table>{!filtered.problems.length && <p className={styles.Empty}>No captured problems match these filters.</p>}
  </section>;
  const rightRegion = <div className={styles.RightRegion}>{problemsOpen ? <ResizableSplitPane direction='vertical' reverse defaultSize={174} minSize={70} maxSize={450} handleLabel='Resize Problems'>{[detail, problemsPanel]}</ResizableSplitPane> : <>{detail}<Button size='sm' variant='ghost' color='neutral' onClick={() => {
    setProblemsOpen(true); 
  }}>Problems ({filtered.problems.length})</Button></>}</div>;
  return <div className={styles.Root}><Toolbar size='sm' className={styles.Toolbar}>
    <Toolbar.Group aria-label='Inventory filters'>
      <SearchInput role='searchbox' size='sm' className={styles.Search} aria-label='Search extensions' placeholder='Search extensions…' value={query} onValueChange={setQuery} />
      <Select size='sm' value={pluginId} onValueChange={value => {
        const next = new URLSearchParams(params);
        if (value) {
          next.set('plugin', value);
        } else {
          next.delete('plugin');
        }

        setParams(next);
      }}><Select.Trigger aria-label='Filter plugin' className={styles.PluginFilter}><Select.Value>{value => value === '' ? 'All plugins' : value ?? 'All plugins'}</Select.Value><Select.Icon /></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup><Select.List><Select.Item value=''>All plugins</Select.Item>{[...new Set([...snapshot.plugins.map(item => item.id), ...snapshot.points.flatMap(item => item.contributions.map(value => value.pluginId)), ...snapshot.pending.map(item => item.pluginId)])].sort().map(id => <Select.Item key={id} value={id}>{id}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal></Select>
      <Checkbox.Item size='sm' checked={issuesOnly} onCheckedChange={setIssuesOnly}>Issues only</Checkbox.Item>
    </Toolbar.Group>
    <span className={styles.Live} title={`${snapshot.windowName} · captured ${snapshot.capturedAt}${snapshot.truncated ? ' · truncated' : ''}`}><StatusDot size='xs' status={paused ? 'warning' : 'success'} label={paused ? 'Paused' : 'Live'} /></span>
    <Toolbar.Group className={styles.ToolbarActions} aria-label='Capture actions'>
      <Button size='sm' variant='ghost' color='neutral' disabled={!diagnostics.windowName} onClick={() => {
        setPaused(paused ? null : diagnostics.capture()); setSensitive(null); 
      }}>{paused ? 'Resume live' : 'Pause'}</Button>
      <Button size='sm' variant='outline' color='neutral' disabled={!diagnostics.windowName} onClick={() => {
        const safe = paused ? { ...paused, problems: paused.problems.map(({ stack: _stack, componentStack: _componentStack, ...problem }) => ({ ...problem, message: 'Sensitive diagnostic text redacted.' })), plugins: paused.plugins.map(plugin => ({ ...plugin, error: plugin.error ? 'Sensitive diagnostic text redacted.' : undefined, warnings: plugin.warnings.map(() => 'Sensitive diagnostic text redacted.') })) } : diagnostics.capture(); saveSnapshot(safe); 
      }}>Export safe JSON</Button>
      <Button size='sm' variant='ghost' color='neutral' disabled={!diagnostics.windowName} onClick={() => {
        setExportPreview(paused ?? diagnostics.capture(true)); 
      }}>Sensitive export…</Button>
    </Toolbar.Group></Toolbar>
  {!diagnostics.windowName && <p role={diagnostics.identityError ? 'alert' : 'status'}>{diagnostics.identityError ?? 'Resolving runtime window identity…'}</p>}
  <div className={styles.Workspace}><ResizableSplitPane defaultSize={compactLayout ? 228 : 282} minSize={160} maxSize={compactLayout ? 228 : 500} handleLabel='Resize inventory'>{[tree, rightRegion]}</ResizableSplitPane></div>
  {recover && <Dialog open size='sm' onClose={closeRecovery}><Dialog.Title>Re-enable contribution?</Dialog.Title><Dialog.Body><p>This clears captured crash evidence. Export a snapshot first. The contribution may fail again.</p>{recoveryError && <p role='alert'>{recoveryError}</p>}</Dialog.Body><Dialog.Footer><Button autoFocus onClick={closeRecovery}>Cancel</Button><Button disabled={!diagnostics.windowName} onClick={() => {
    try {
      diagnostics.unquarantine(recover.id, recover.snapshot); closeRecovery(); 
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Recovery failed.'); 
    } 
  }}>Re-enable</Button></Dialog.Footer></Dialog>}
  {exportPreview && <Dialog open onClose={() => {
    setExportPreview(null); 
  }}><Dialog.Title>Export sensitive diagnostics?</Dialog.Title><Dialog.Body><p>Exception text may contain credentials and private resource data. Review before saving.</p><pre className={styles.Preview}>{JSON.stringify(exportPreview, null, 2)}</pre></Dialog.Body><Dialog.Footer><Button autoFocus onClick={() => {
      setExportPreview(null); 
    }}>Cancel</Button><Button onClick={() => {
      saveSnapshot(exportPreview); setExportPreview(null); 
    }}>Save sensitive JSON</Button></Dialog.Footer></Dialog>}
  </div>;
}
