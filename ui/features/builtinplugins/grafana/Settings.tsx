import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input, Stack, Text } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import type { MetricDataSource, MetricDefinition, ProviderConnection, PluginSettingsBodyProps, ResourceSetQueryRequest } from '@omniviewdev/runtime';
import { Mappings } from './Mappings';
import './grafana.css';
import ValidationContext, { type ValidationSample } from './ValidationContext';
import { SiGrafana } from 'react-icons/si';
import { LuCheck, LuDatabase, LuKeyRound, LuPlug, LuSettings, LuTrash2 } from 'react-icons/lu';
import DatasourceSelector from './DatasourceSelector';

export default function GrafanaSettings({ registerNavigation }: Partial<PluginSettingsBodyProps>) {
  const [tab, setTab] = useState('Connections');
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [definitions, setDefinitions] = useState<MetricDefinition[]>([]);
  const [sources, setSources] = useState<Record<string, MetricDataSource[]>>({});
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<ProviderConnection>();
  const [step, setStep] = useState(0);
  const [datasourceUID, setDatasourceUID] = useState('');
  const [error, setError] = useState('');
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MetricDefinition>>({});
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [validationSample, setValidationSample] = useState<ValidationSample>();
  const sampleRequest = useMemo<ResourceSetQueryRequest | undefined>(() => {
    if (!validationSample?.resource || !selected || !datasourceUID || !validationSample.cluster) return undefined;
    const now = Date.now();
    return {
      resource_plugin_id: validationSample.context.pluginID, resource_connection_id: validationSample.context.connectionID,
      binding_id: '', source: { plugin_id: 'grafana', connection_id: selected, datasource_uid: datasourceUID, datasource_kind: 'prometheus' },
      resources: [validationSample.resource], definitions: [], metric_ids: [], public_scope: { cluster: validationSample.cluster },
      shape: 0, start_time: new Date(now - 300000).toISOString(), end_time: new Date(now).toISOString(), step: 15000000000, mapping_revision: '',
    };
  }, [validationSample, selected, datasourceUID]);
  const onDraft = useCallback((id: string, draft: MetricDefinition | undefined) => {
    setMappingDrafts(previous => {
      if (JSON.stringify(previous[id]) === JSON.stringify(draft)) return previous;
      const next = { ...previous }; if (draft) next[id] = draft; else delete next[id]; return next;
    });
  }, []);
  useEffect(() => {
    if (!registerNavigation) return;
    registerNavigation({
      hasDrafts: Boolean(editing) || Object.keys(mappingDrafts).length > 0, saving: busy,
      discard: () => { if (credential.current) credential.current.value = ''; setEditing(undefined); setMappingDrafts({}); setDraftEpoch(value => value + 1); },
      save: async () => {
        if (editing) { setTab('Connections'); setStep(2); setError('Finish Save and test before leaving settings.'); return false; }
        if (!selected || !datasourceUID) { setTab('Global mappings'); setError('Choose a connection and datasource before validating drafts.'); return false; }
        setBusy(true);
        try {
          for (const draft of Object.values(mappingDrafts)) {
            const validation = await MetricClient.ValidateMetricDefinition('grafana', selected, datasourceUID, draft);
            if (!validation?.valid) { setError(validation?.issues.map(issue => issue.message).join('; ') || 'Definition invalid.'); return false; }
          }
          for (const draft of Object.values(mappingDrafts)) await MetricClient.SaveMetricDefinition(draft);
          setMappingDrafts({}); await load(); setDraftEpoch(value => value + 1); return true;
        } catch (err) { setError(String(err)); return false; }
        finally { setBusy(false); }
      },
    });
    return () => registerNavigation(null);
  }, [registerNavigation, editing, mappingDrafts, busy, selected, datasourceUID]);
  const credential = useRef<HTMLInputElement>(null);
  async function load() {
    const [catalog, mappings] = await Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricDefinitions()]);
    setConnections(catalog ?? []); setDefinitions(mappings ?? []);
  }
  useEffect(() => { let active = true; Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricDefinitions()]).then(([catalog, mappings]) => {
    if (active) { setConnections(catalog ?? []); setDefinitions(mappings ?? []); }
  }).catch(err => { if (active) setError(String(err)); }); return () => { active = false; }; }, []);
  async function discover(connectionID: string) {
    setError(''); setSelected(connectionID); setDatasourceUID('');
    setCatalogErrors(previous => ({ ...previous, [connectionID]: '' }));
    try { const catalog = await MetricClient.GetDataSources('grafana', connectionID); setSources(previous => ({ ...previous, [connectionID]: catalog ?? [] })); }
    catch (err) { setCatalogErrors(previous => ({ ...previous, [connectionID]: String(err) })); }
  }
  function start(connection?: ProviderConnection) {
    setEditing(connection ?? { id: crypto.randomUUID(), name: '', plugin_id: 'grafana', kind: 'prometheus', url: '', has_credentials: false, public_config: { credentialKind: 'cloud-access-policy', username: '' } });
    setStep(0); setError('');
  }
  async function save() {
    if (!editing) return;
    setBusy(true); setError('');
    const token = credential.current?.value;
    if (credential.current) credential.current.value = '';
    try {
      const saved = await MetricClient.SaveProviderConnection('grafana', { connection: editing, ...(token ? { credential: token } : {}) });
      if (!saved) throw new Error('Provider returned no saved connection.');
      const result = await MetricClient.TestProviderConnection('grafana', saved.id);
      await load();
      if (!result?.valid) { setError(result?.issues.map(issue => issue.message).join('; ') || 'Connection test failed. Saved connection remains available for correction.'); return; }
      setEditing(undefined); setStatus('Connection saved and reachable. Test a real datasource query to verify query access.'); await discover(saved.id);
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  return <section className="grafana-settings" aria-label="Grafana settings"><header><Stack direction="row" align="center" spacing={2}><SiGrafana size={20} color="#f46800" aria-hidden /><Text weight="semibold">Grafana</Text></Stack><Text size="sm">Reusable metric providers. Bind sources in each resource connection’s settings.</Text></header>
    <div role="tablist" aria-label="Grafana settings sections" className="grafana-tabs">{['Connections', 'Data sources', 'Global mappings'].map(value => <Button size="sm" role="tab" aria-selected={tab === value} key={value} onClick={() => { if (editing && value !== 'Connections') { setError('Save or cancel connection setup before changing section.'); return; } setTab(value); }}>{value}</Button>)}</div>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {tab === 'Connections' && <><Button size="sm" onClick={() => start()}><LuPlug size={14} aria-hidden />Connect Grafana</Button><div className="grafana-connections">{connections.map(connection => <Card className="grafana-connection" key={connection.id}>
      <Stack direction="row" justify="between"><Stack direction="row" align="center" spacing={2}><SiGrafana size={20} color="#f46800" aria-hidden /><Text weight="semibold">{connection.name}</Text></Stack><Text size="xs"><LuKeyRound size={12} aria-hidden /> {connection.has_credentials ? 'Credential stored privately' : 'No credential'}</Text></Stack>
      <Text size="sm">{connection.url}</Text><Text size="xs">{connection.kind === 'grafana' ? 'Grafana gateway' : 'Prometheus / Mimir'} · Query access not verified by health test</Text>
      <Stack direction="row" spacing={2}><Button size="sm" onClick={async () => { try { const result = await MetricClient.TestProviderConnection('grafana', connection.id); setStatus(result?.valid ? 'Connection reachable. Use Test query to verify datasource access.' : result?.issues?.map(issue => issue.message).join('; ') || 'Connection test failed.'); } catch (err) { setError(String(err)); } }}><LuCheck size={14} aria-hidden />Test connection</Button><Button size="sm" onClick={() => start(connection)}><LuSettings size={14} aria-hidden />Manage</Button><Button size="sm" onClick={() => { setTab('Data sources'); void discover(connection.id); }}><LuDatabase size={14} aria-hidden />View sources</Button><Button size="sm" onClick={async () => { if (!window.confirm(`Delete ${connection.name}? Existing bindings will report unavailable source.`)) return; try { await MetricClient.DeleteProviderConnection('grafana', connection.id); await load(); } catch (err) { setError(String(err)); } }}><LuTrash2 size={14} aria-hidden />Delete</Button></Stack>
    </Card>)}</div></>}
    {editing && tab === 'Connections' && <Card className="grafana-setup"><Text weight="semibold">Connect a metric provider</Text><ol className="grafana-stepper">{['Instance', 'Read token', 'Verify'].map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined}>{i + 1}. {label}</li>)}</ol>
      {step === 0 && <Stack direction="column" spacing={2}><label>Name<Input.Control value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label><label>Transport<select value={editing.kind} onChange={event => setEditing({ ...editing, kind: event.target.value, public_config: { ...editing.public_config, credentialKind: event.target.value === 'grafana' ? 'grafana-service-account' : 'cloud-access-policy' } })}><option value="prometheus">Grafana Cloud / direct Prometheus or Mimir</option><option value="grafana">Self-hosted Grafana gateway</option></select></label><label>Endpoint URL<Input.Control type="url" value={editing.url} onChange={event => setEditing({ ...editing, url: event.target.value })} /></label><label><input type="checkbox" checked={editing.public_config.allowInsecureHTTP === 'true'} onChange={event => setEditing({ ...editing, public_config: { ...editing.public_config, allowInsecureHTTP: String(event.target.checked) } })} />Allow unencrypted HTTP for this self-hosted endpoint</label><Text size="xs">HTTP exposes credentials and metric data to network observers. Use only trusted local networks.</Text></Stack>}
      <div hidden={step !== 1}><Stack direction="column" spacing={2}><Text size="sm">{editing.kind === 'grafana' ? 'Create a Grafana service account with datasource query and datasource read permissions. Use only Prometheus-compatible datasources.' : 'Create a Grafana Cloud access policy with metrics:read for this stack. Use the Prometheus query endpoint and instance ID; never use a write token.'}</Text><label>Credential type<select value={editing.public_config.credentialKind} onChange={event => setEditing({ ...editing, public_config: { ...editing.public_config, credentialKind: event.target.value } })}>{(editing.kind === 'grafana' ? ['grafana-service-account'] : ['cloud-access-policy', 'prometheus-token']).map(kind => <option key={kind}>{kind}</option>)}</select></label><label>Cloud instance ID / username (optional)<Input.Control value={editing.public_config.username ?? ''} onChange={event => setEditing({ ...editing, public_config: { ...editing.public_config, username: event.target.value } })} /></label><label>Read token<input ref={credential} type="password" autoComplete="new-password" placeholder={editing.has_credentials ? 'Leave blank to retain stored credential' : 'Read-only token'} /></label><Text size="xs">Token goes directly to backend secret storage. Browser storage never receives it.</Text></Stack></div>
      {step === 2 && <Text size="sm">Save {editing.name} and check reachability. Verify datasource permissions separately with a real Test query.</Text>}
      <Stack direction="row" spacing={2}><Button size="sm" disabled={busy} onClick={() => { if (credential.current) credential.current.value = ''; setEditing(undefined); }}>Cancel</Button>{step > 0 && <Button size="sm" disabled={busy} onClick={() => setStep(step - 1)}>Back</Button>}{step < 2 ? <Button size="sm" disabled={!editing.name || !editing.url} onClick={() => setStep(step + 1)}>Continue</Button> : <Button size="sm" disabled={busy} onClick={() => void save()}>Save and test</Button>}</Stack>
    </Card>}
    {tab !== 'Connections' && <label>Provider connection<select value={selected} onChange={event => void discover(event.target.value)}><option value="">Choose connection</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>}
    {tab === 'Data sources' && <>{catalogErrors[selected] && <p role="alert">Datasource discovery unavailable: {catalogErrors[selected]}</p>}<div className="grafana-connections">{(sources[selected] ?? []).map(source => <Card key={source.uid}><Text weight="semibold">{source.name}</Text><Text size="sm">{source.kind} · {source.uid}</Text></Card>)}{selected && !sources[selected]?.length && !catalogErrors[selected] && <Text size="sm">No Prometheus datasources discovered.</Text>}</div></>}
    <div hidden={tab !== 'Global mappings'}><DatasourceSelector sources={sources[selected] ?? []} value={datasourceUID} disabled={!selected} catalogError={catalogErrors[selected]} onChange={setDatasourceUID} />
      <ValidationContext resourceTypes={[...new Set(definitions.flatMap(definition => definition.resource_keys))]} onChange={setValidationSample} />
      <Mappings key={draftEpoch} definitions={definitions} connectionID={selected} datasourceUID={datasourceUID} onDraft={onDraft} sampleRequest={sampleRequest} schemaContext={validationSample?.context} save={async definition => { await MetricClient.SaveMetricDefinition(definition); onDraft(definition.id, undefined); await load(); }} />
    </div>
  </section>;
}
