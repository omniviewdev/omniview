import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Checkbox, Input, Stack, Text } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import { Browser } from '@omniviewdev/runtime/runtime';
import type { MetricDataSource, MetricDefinition, ProviderConnection, PluginSettingsBodyProps, MetricsObservationSpec } from '@omniviewdev/runtime';
import { Mappings } from './Mappings';
import './grafana.css';
import ValidationContext, { type ValidationSample } from './ValidationContext';
import { SiGrafana } from 'react-icons/si';
import { LuCheck, LuDatabase, LuExternalLink, LuKeyRound, LuPlug, LuSettings, LuTrash2 } from 'react-icons/lu';
import DatasourceSelector, { MetricsSelect } from './DatasourceSelector';

const credentialLabels: Record<string, string> = {
  'grafana-service-account': 'Grafana service account token',
  'cloud-access-policy': 'Grafana Cloud access policy token',
  'prometheus-token': 'Prometheus bearer token',
};

export default function GrafanaSettings({ registerNavigation }: Partial<PluginSettingsBodyProps>) {
  const [tab, setTab] = useState('Connections');
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [definitions, setDefinitions] = useState<MetricDefinition[]>([]);
  const [sources, setSources] = useState<Record<string, MetricDataSource[]>>({});
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<ProviderConnection>();
  const [step, setStep] = useState(0);
  const [datasourceUID, setDatasourceUID] = useState('');
  const [defaultRevision, setDefaultRevision] = useState('');
  const [defaultSource, setDefaultSource] = useState('');
  const [error, setError] = useState('');
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const editorGeneration = useRef(0);
  const discoveryGeneration = useRef(0);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MetricDefinition>>({});
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [validationSample, setValidationSample] = useState<ValidationSample>();
  const sampleRequest = useMemo<MetricsObservationSpec | undefined>(() => {
    if (!validationSample?.resource || !selected || !datasourceUID) {
      return undefined;
    }

    return {
      owner_plugin_id: validationSample.context.pluginID, owner_connection_id: validationSample.context.connectionID,
      resource_key: validationSample.context.resourceType, binding_id: '',
      source: { plugin_id: 'grafana', connection_id: selected, datasource_uid: datasourceUID, datasource_kind: 'prometheus' },
      targets: [validationSample.resource], metric_ids: [], shape: 'range',
      start_time: '0001-01-01T00:00:00Z', end_time: '0001-01-01T00:00:00Z', duration_ms: 300000, step_ms: 15000, interval_ms: 0,
    };
  }, [validationSample, selected, datasourceUID]);
  const onDraft = useCallback((id: string, draft: MetricDefinition | undefined) => {
    setMappingDrafts(previous => {
      if (JSON.stringify(previous[id]) === JSON.stringify(draft)) {
        return previous;
      }

      if (draft) {
        return { ...previous, [id]: draft };
      }

      return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id));
    });
  }, []);
  useEffect(() => {
    if (!registerNavigation) {
      return;
    }

    registerNavigation({
      hasDrafts: Boolean(editing) || Object.keys(mappingDrafts).length > 0, saving: busy,
      discard: () => {
        if (busy) {
          return;
        }

        editorGeneration.current++; discoveryGeneration.current++; if (credential.current) {
          credential.current.value = '';
        }

        setEditing(undefined); setMappingDrafts({}); setDraftEpoch(value => value + 1); 
      },
      save: async () => {
        if (editing) {
          setTab('Connections'); setStep(2); setError('Finish Save and test before leaving settings.'); return false; 
        }

        if (!selected || !datasourceUID) {
          setTab('Global mappings'); setError('Choose a connection and datasource before validating drafts.'); return false; 
        }

        setBusy(true);
        try {
          for (const draft of Object.values(mappingDrafts)) {
            const validation = await MetricClient.ValidateMetricDefinition('grafana', selected, datasourceUID, draft);
            if (!validation?.valid) {
              const issues = validation?.issues.map(issue => issue.message).join('; ') ?? '';
              setError(issues.length > 0 ? issues : 'Definition invalid.'); return false;
            }
          }

          for (const draft of Object.values(mappingDrafts)) {
            await MetricClient.SaveMetricDefinition(draft);
          }

          setMappingDrafts({}); await load(); setDraftEpoch(value => value + 1); return true;
        } catch (err) {
          setError(String(err)); return false; 
        } finally {
          setBusy(false); 
        }
      },
    });
    return () => {
      registerNavigation(null); 
    };
  }, [registerNavigation, editing, mappingDrafts, busy, selected, datasourceUID]);
  const credential = useRef<HTMLInputElement>(null);
  async function load(generation = editorGeneration.current) {
    const [catalog, mappings] = await Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricDefinitions()]);
    if (generation !== editorGeneration.current) {
      return;
    }

    setConnections(catalog ?? []); setDefinitions(mappings ?? []);
  }

  useEffect(() => () => {
    editorGeneration.current++; discoveryGeneration.current++; if (credential.current) {
      credential.current.value = '';
    } 
  }, []);
  useEffect(() => {
    let active = true; Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricDefinitions(), MetricClient.GetMetricSourceDefaults()]).then(([catalog, mappings, defaults]) => {
      if (active) {
        setConnections(catalog ?? []); setDefinitions(mappings ?? []); setDefaultRevision(defaults?.revision ?? ''); setDefaultSource(defaults?.source ? `${defaults.source.connection_id} / ${defaults.source.datasource_uid}` : 'Native source'); 
      }
    }).catch(err => {
      if (active) {
        setError(String(err));
      } 
    }); return () => {
      active = false; 
    }; 
  }, []);
  async function discover(connectionID: string) {
    const generation = editorGeneration.current;
    const discovery = ++discoveryGeneration.current;
    setError(''); setSelected(connectionID); setDatasourceUID('');
    setCatalogErrors(previous => ({ ...previous, [connectionID]: '' }));
    try {
      const catalog = await MetricClient.GetDataSources('grafana', connectionID);
      if (generation === editorGeneration.current && discovery === discoveryGeneration.current) {
        setSources(previous => ({ ...previous, [connectionID]: catalog ?? [] }));
      }
    } catch (err) {
      if (generation === editorGeneration.current && discovery === discoveryGeneration.current) {
        setCatalogErrors(previous => ({ ...previous, [connectionID]: String(err) }));
      }
    }
  }

  function start(connection?: ProviderConnection) {
    if (busy) {
      return;
    }

    editorGeneration.current++; discoveryGeneration.current++;
    if (credential.current) {
      credential.current.value = '';
    }

    setEditing(connection ?? { id: crypto.randomUUID(), name: '', plugin_id: 'grafana', kind: 'prometheus', url: '', has_credentials: false, public_config: { credentialKind: 'cloud-access-policy', username: '' } });
    setStep(0); setError('');
  }

  async function testConnection(connectionID: string) {
    if (busy) {
      return;
    }

    const generation = editorGeneration.current;
    setBusy(true); setError('');
    try {
      const result = await MetricClient.TestProviderConnection('grafana', connectionID);
      if (generation === editorGeneration.current) {
        const issues = result?.issues?.map(issue => issue.message).join('; ') ?? '';
        setStatus(result?.valid ? 'Connection reachable. Use Test query to verify datasource access.' : issues.length > 0 ? issues : 'Connection test failed.');
      }
    } catch (err) {
      if (generation === editorGeneration.current) {
        setError(String(err));
      } 
    } finally {
      if (generation === editorGeneration.current) {
        setBusy(false);
      } 
    }
  }

  async function save() {
    if (!editing || busy) {
      return;
    }

    const generation = editorGeneration.current;
    setBusy(true); setError('');
    const token = credential.current?.value;
    if (credential.current) {
      credential.current.value = '';
    }

    try {
      const saved = await MetricClient.SaveProviderConnection('grafana', { connection: editing, ...(token ? { credential: token } : {}) });
      if (generation !== editorGeneration.current) {
        return;
      }

      if (!saved) {
        throw new Error('Provider returned no saved connection.');
      }

      const result = await MetricClient.TestProviderConnection('grafana', saved.id);
      if (generation !== editorGeneration.current) {
        return;
      }

      await load(generation);
      if (generation !== editorGeneration.current) {
        return;
      }

      if (!result?.valid) {
        const issues = result?.issues?.map(issue => issue.message).join('; ') ?? '';
        setError(issues.length > 0 ? issues : 'Connection test failed. Saved connection remains available for correction.'); return;
      }

      setEditing(undefined); setStatus('Connection saved and reachable. Test a real datasource query to verify query access.'); await discover(saved.id);
    } catch (err) {
      if (generation === editorGeneration.current) {
        setError(String(err));
      } 
    } finally {
      if (generation === editorGeneration.current) {
        setBusy(false);
      } 
    }
  }

  return <section className="grafana-settings" aria-label="Grafana settings"><header><Stack direction="row" align="center" spacing={2}><SiGrafana size={20} color="#f46800" aria-hidden /><Text weight="semibold">Grafana</Text></Stack><Text size="sm">Reusable metric providers. Bind sources in each resource connection’s settings.</Text></header>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
      <div role="tablist" aria-label="Grafana settings sections" className="grafana-tabs">{['Connections', 'Data sources', 'Global mappings'].map(value => <Button size="sm" role="tab" aria-selected={tab === value} key={value} onClick={() => {
        if (editing && value !== 'Connections') {
          setError('Save or cancel connection setup before changing section.'); return; 
        }

        setTab(value); 
      }}>{value}</Button>)}</div>
      {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
      {tab === 'Connections' && <><Button size="sm" onClick={() => {
        start(); 
      }}><LuPlug size={14} aria-hidden />Connect Grafana</Button><div className="grafana-connections">{connections.map(connection => <Card className="grafana-connection" key={connection.id}>
        <Stack direction="row" justify="between"><Stack direction="row" align="center" spacing={2}><SiGrafana size={20} color="#f46800" aria-hidden /><Text weight="semibold">{connection.name}</Text></Stack><Text size="xs"><LuKeyRound size={12} aria-hidden /> {connection.has_credentials ? 'Credential stored privately' : 'No credential'}</Text></Stack>
        <Text size="sm">{connection.url}</Text><Text size="xs">{connection.kind === 'grafana' ? 'Grafana gateway' : 'Prometheus / Mimir'} · Query access not verified by health test</Text>
        <Stack direction="row" spacing={2}><Button size="sm" onClick={async () => testConnection(connection.id)}><LuCheck size={14} aria-hidden />Test connection</Button><Button size="sm" onClick={() => {
          start(connection); 
        }}><LuSettings size={14} aria-hidden />Manage</Button><Button size="sm" onClick={async () => {
          setTab('Data sources'); return discover(connection.id);
        }}><LuDatabase size={14} aria-hidden />View sources</Button><Button size="sm" onClick={async () => {
          if (!window.confirm(`Delete ${connection.name}? Existing bindings will report unavailable source.`)) {
            return;
          }

          try {
            await MetricClient.DeleteProviderConnection('grafana', connection.id); await load(); 
          } catch (err) {
            setError(String(err)); 
          } 
        }}><LuTrash2 size={14} aria-hidden />Delete</Button></Stack>
      </Card>)}</div></>}
      {editing && tab === 'Connections' && <Card className="grafana-setup"><Text weight="semibold">Connect a metric provider</Text><ol className="grafana-stepper">{['Instance', 'Read token', 'Verify'].map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined}>{i + 1}. {label}</li>)}</ol>
        {step === 0 && <Stack direction="column" spacing={2}><label>Name<Input.Root><Input.Control value={editing.name} onChange={event => {
          setEditing({ ...editing, name: event.target.value }); 
        }} /></Input.Root></label><label>Transport<MetricsSelect label="Transport" value={editing.kind} onChange={value => {
          setEditing({ ...editing, kind: value, public_config: { ...editing.public_config, credentialKind: value === 'grafana' ? 'grafana-service-account' : 'cloud-access-policy' } }); 
        }} options={[{ value: 'prometheus', label: 'Grafana Cloud / direct Prometheus or Mimir' }, { value: 'grafana', label: 'Self-hosted Grafana gateway' }]} /></label><label>Endpoint URL<Input.Root><Input.Control type="url" value={editing.url} onChange={event => {
          setEditing({ ...editing, url: event.target.value }); 
        }} /></Input.Root></label>
        <Checkbox size="sm" className="grafana-http-checkbox" checked={editing.public_config.allowInsecureHTTP === 'true'} onCheckedChange={checked => {
          setEditing({ ...editing, public_config: { ...editing.public_config, allowInsecureHTTP: String(checked) } }); 
        }}>Allow unencrypted HTTP for this endpoint</Checkbox>
        <Text size="xs">HTTP exposes credentials and metrics. Use only trusted local networks.</Text>
        </Stack>}
        <div hidden={step !== 1}><Stack direction="column" spacing={2}>
          <Text size="sm">{editing.kind === 'grafana' ? 'Administration → Users and access → Service accounts. Create an account, grant datasource query access, then add a token.' : editing.public_config.credentialKind === 'prometheus-token' ? 'Use a bearer token with query access from your Prometheus-compatible service.' : 'Create a Cloud access policy with metrics:read. Use this stack’s query endpoint and instance ID.'}</Text>
          <Button size="sm" variant="ghost" onClick={async () => Browser.OpenURL(editing.kind === 'grafana' ? 'https://grafana.com/docs/grafana/latest/administration/service-accounts/#add-a-token-to-a-service-account-in-grafana' : editing.public_config.credentialKind === 'prometheus-token' ? 'https://prometheus.io/docs/operating/security/' : 'https://grafana.com/docs/grafana-cloud/security-and-account-management/authentication-and-permissions/access-policies/').catch(err => {
            setError(String(err));
          })}><LuExternalLink size={14} aria-hidden />{editing.kind === 'grafana' ? 'Service account setup' : editing.public_config.credentialKind === 'prometheus-token' ? 'Authentication guidance' : 'Cloud access policy setup'}</Button>
          <label>Credential type<MetricsSelect label="Credential type" value={editing.public_config.credentialKind ?? (editing.kind === 'grafana' ? 'grafana-service-account' : 'cloud-access-policy')} onChange={value => {
            setEditing({ ...editing, public_config: { ...editing.public_config, credentialKind: value } }); 
          }} options={(editing.kind === 'grafana' ? ['grafana-service-account'] : ['cloud-access-policy', 'prometheus-token']).map(value => ({ value, label: credentialLabels[value] ?? value }))} /></label>
          <label>Cloud instance ID / username (optional)<Input.Root><Input.Control value={editing.public_config.username ?? ''} onChange={event => {
            setEditing({ ...editing, public_config: { ...editing.public_config, username: event.target.value } }); 
          }} /></Input.Root></label>
          <label>Read token<Input.Root><Input.Control ref={credential} type="password" autoComplete="new-password" placeholder={editing.has_credentials ? 'Leave blank to retain stored credential' : 'Read-only token'} /></Input.Root></label>
          <Text size="xs">Stored privately on this device. Never saved in browser storage.</Text>
        </Stack></div>
        {step === 2 && <Text size="sm">Save {editing.name} and check reachability. Verify datasource permissions separately with a real Test query.</Text>}
        <Stack direction="row" spacing={2}><Button size="sm" disabled={busy} onClick={() => {
          editorGeneration.current++; discoveryGeneration.current++; if (credential.current) {
            credential.current.value = '';
          }

          setEditing(undefined); 
        }}>Cancel</Button>{step > 0 && <Button size="sm" disabled={busy} onClick={() => {
          setStep(step - 1); 
        }}>Back</Button>}{step < 2 ? <Button size="sm" disabled={!editing.name || !editing.url} onClick={() => {
          setStep(step + 1); 
        }}>Continue</Button> : <Button size="sm" disabled={busy} onClick={save}>Save and test</Button>}</Stack>
      </Card>}
      {tab !== 'Connections' && <label>Provider connection<MetricsSelect label="Provider connection" value={selected} onChange={discover} options={[{ value: '', label: 'Choose connection' }, ...connections.map(connection => ({ value: connection.id, label: connection.name }))]} /></label>}
      {tab === 'Data sources' && <>{catalogErrors[selected] && <p role="alert">Datasource discovery unavailable: {catalogErrors[selected]}</p>}<div className="grafana-connections">{(sources[selected] ?? []).map(source => <Card key={source.uid}><Text weight="semibold">{source.name}</Text><Text size="sm">{source.kind} · {source.uid}</Text></Card>)}{selected && !sources[selected]?.length && !catalogErrors[selected] && <Text size="sm">No Prometheus datasources discovered.</Text>}</div></>}
      <div hidden={tab !== 'Global mappings'}><DatasourceSelector sources={sources[selected] ?? []} value={datasourceUID} disabled={!selected} catalogError={catalogErrors[selected]} onChange={setDatasourceUID} />
        <section className="grafana-provider-card" aria-label="Global source default"><strong>Default metrics source</strong><Text size="sm">{defaultSource}. Per-connection bindings override this profile default.</Text>
          <Stack direction="row" spacing={2}><Button size="sm" disabled={!selected || !datasourceUID || busy} onClick={async () => {
            setBusy(true); setError('');
            try {
              const result = await MetricClient.SaveMetricSourceDefaults({ revision: defaultRevision, source: { plugin_id: 'grafana', connection_id: selected, datasource_uid: datasourceUID, datasource_kind: 'prometheus' } }); setDefaultRevision(result.revision); setDefaultSource(`${selected} / ${datasourceUID}`); setStatus('Global source default saved'); 
            } catch (err) {
              setError(String(err)); 
            } finally {
              setBusy(false); 
            }
          }}>Use selected source globally</Button><Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try {
              const result = await MetricClient.SaveMetricSourceDefaults({ revision: defaultRevision }); setDefaultRevision(result.revision); setDefaultSource('Native source'); setStatus('Global source reset to native'); 
            } catch (err) {
              setError(String(err)); 
            } finally {
              setBusy(false); 
            }
          }}>Reset to native</Button></Stack>
        </section>
        <ValidationContext resourceTypes={[...new Set(definitions.flatMap(definition => definition.resource_keys))]} onChange={setValidationSample} />
        <Mappings key={draftEpoch} definitions={definitions} connectionID={selected} datasourceUID={datasourceUID} onDraft={onDraft} sampleRequest={sampleRequest} schemaContext={validationSample?.context} save={async definition => {
          await MetricClient.SaveMetricDefinition(definition); onDraft(definition.id, undefined); await load(); 
        }} />
      </div>
    </fieldset>
  </section>;
}
