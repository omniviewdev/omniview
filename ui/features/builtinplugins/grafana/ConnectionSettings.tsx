import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Text } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import type { ConnectionSettingsContext, MetricBinding, MetricDataSource, MetricDefinition, ProviderConnection, ResourceMetricTarget, MetricsObservationSpec } from '@omniviewdev/runtime';
import { navigateActivePage } from '@omniviewdev/runtime';
import { MappingEditor, QueryPreview } from './Mappings';
import { changeProvider, resetOverride, resolveDefinition, stageDefinition } from './model';
import SampleResource from './SampleResource';
import DatasourceSelector, { MetricsSelect } from './DatasourceSelector';
import { SiGrafana } from 'react-icons/si';

export default function GrafanaConnectionSettings({ resourcePluginID, connectionID, resourceTypes }: ConnectionSettingsContext) {
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [definitions, setDefinitions] = useState<MetricDefinition[]>([]);
  const [saved, setSaved] = useState<MetricBinding>();
  const [draft, setDraft] = useState<MetricBinding>();
  const sourceConnectionID = draft?.source.connection_id ?? '';
  const [error, setError] = useState('');
  const sourceContext = useMemo(() => ({ connectionID: sourceConnectionID }), [sourceConnectionID]);
  const [sourceResult, setSourceResult] = useState<{ context: typeof sourceContext; sources: MetricDataSource[]; error: string }>();
  const sources = sourceResult?.context === sourceContext ? sourceResult.sources : [];
  const catalogError = sourceResult?.context === sourceContext ? sourceResult.error : '';
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MetricDefinition>>({});
  const onMappingDraft = useCallback((id: string, value: MetricDefinition | undefined) => {
    setMappingDrafts(previous => {
      if (JSON.stringify(previous[id]) === JSON.stringify(value)) {
        return previous;
      }

      if (value) {
        return { ...previous, [id]: value };
      }

      return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id));
    }); 
  }, []);
  const [sample, setSample] = useState<ResourceMetricTarget>();
  const [sampleType, setSampleType] = useState(resourceTypes[0] ?? '');
  const [search, setSearch] = useState('');
  const sampleSource = draft?.source;
  const sampleRequest = useMemo<MetricsObservationSpec | undefined>(() => {
    if (!sample || !sampleSource?.datasource_uid) {
      return undefined;
    }

    return { owner_plugin_id: resourcePluginID, owner_connection_id: connectionID, resource_key: sample.reference.address.type,
      binding_id: saved?.id ?? '', source: sampleSource, targets: [sample], metric_ids: [], shape: 'range',
      start_time: '', end_time: '', duration_ms: 300000, step_ms: 15000, interval_ms: 0 };
  }, [sample, sampleSource, saved?.id, resourcePluginID, connectionID]);
  useEffect(() => {
    let active = true;
    Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricDefinitions(), MetricClient.GetMetricBindings(resourcePluginID, connectionID), MetricClient.GetMetricSourceDefaults()]).then(([catalog, globals, bindings, defaults]) => {
      if (!active) {
        return;
      }

      setConnections(catalog ?? []); setDefinitions(globals ?? []);
      const binding = bindings?.find(value => value.signal === 'metrics' && value.source.plugin_id === 'grafana');
      setSaved(binding);
      setDraft(binding ?? { id: crypto.randomUUID(), signal: 'metrics', resource_plugin_id: resourcePluginID, resource_connection_id: connectionID, source: defaults?.source?.plugin_id === 'grafana' ? defaults.source : { plugin_id: 'grafana', connection_id: '', datasource_uid: '', datasource_kind: '' }, policy: 'supplement', public_scope: {}, overrides: [], revision: '' });
    }).catch(err => {
      if (active) {
        setError(String(err));
      } 
    });
    return () => {
      active = false;
    };
  }, [resourcePluginID, connectionID]);
  useEffect(() => {
    let active = true;
    if (sourceContext.connectionID) {
      MetricClient.GetDataSources('grafana', sourceContext.connectionID).then(values => {
        if (!values) {
          throw new Error('No datasource catalog returned.');
        }

        if (active) {
          setSourceResult({ context: sourceContext, sources: values.filter(value => value.kind === 'prometheus'), error: '' });
        }
      }).catch(err => {
        if (active) {
          setSourceResult({ context: sourceContext, sources: [], error: String(err) });
        }
      });
    }

    return () => {
      active = false;
    };
  }, [sourceContext]);
  if (!draft) {
    return <Card><Text size="sm">Loading external metric settings…</Text>{error && <p role="alert">{error}</p>}</Card>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || Object.keys(mappingDrafts).length > 0;
  const applicableDefinitions = definitions.filter(definition => !definition.native && definition.resource_keys.some(key => resourceTypes.includes(key)));
  const applicableOverrideCount = draft.overrides.filter(override => applicableDefinitions.some(definition => definition.id === override.metric_id)).length;
  async function saveBinding() {
    if (!draft) {
      return;
    }

    setBusy(true); setError('');
    try {
      let resolved = draft;
      for (const value of Object.values(mappingDrafts)) {
        const validation = await MetricClient.ValidateMetricDefinition('grafana', draft.source.connection_id, draft.source.datasource_uid, value);
        if (!validation) {
          throw new Error('No mapping validation response.');
        }

        if (!validation.valid) {
          throw new Error(validation.issues.map(issue => issue.message).join('; '));
        }

        const global = definitions.find(definition => definition.id === value.id);
        if (global) {
          resolved = stageDefinition(resolved, global, value);
        }
      }

      const value = await MetricClient.SaveMetricBinding(resolved);
      if (!value) {
        throw new Error('No saved binding returned.');
      }

      setSaved(value); setDraft(value); setMappingDrafts({}); setEditorEpoch(value => value + 1);
      setStatus('Changes saved');
    } catch (err) {
      setError(String(err)); 
    } finally {
      setBusy(false); 
    }
  }

  return <div className="grafana-settings grafana-cluster-settings">
    {error && <p role="alert">{error}</p>}
    <section className="grafana-provider-card">
      <header className="grafana-provider-heading"><SiGrafana /><strong>Metrics provider</strong><span className="grafana-spacer" /><span className="grafana-badge">This connection</span><span>Grafana</span></header>
      <div className="grafana-provider-fields">
        <div><label>Grafana connection<MetricsSelect label="Provider connection" value={draft.source.connection_id} disabled={busy}
          onChange={value => {
            setDraft(changeProvider(draft, value)); setMappingDrafts({}); setError(''); 
          }}
          options={[{ value: '', label: 'Choose Grafana connection' }, ...connections.map(connection => ({ value: connection.id, label: connection.name }))]} /></label>
        <small>{connections.find(connection => connection.id === draft.source.connection_id)?.url}</small></div>
        <DatasourceSelector sources={sources} value={draft.source.datasource_uid} disabled={!draft.source.connection_id || busy} catalogError={catalogError} onChange={uid => {
          setDraft({ ...draft, source: { ...draft.source, datasource_uid: uid, datasource_kind: uid ? 'prometheus' : '' } }); 
        }} />
        <label>Use for<MetricsSelect label="Source policy" value={draft.policy} onChange={value => {
          setDraft({ ...draft, policy: value }); 
        }}
        options={[{ value: 'supplement', label: 'Supplement native metrics' }, { value: 'replace', label: 'Replace mapped metrics' }]} /></label>
        <div><label>Cluster label value<Input.Root className="grafana-input" size="md"><Input.Control value={draft.public_scope.cluster ?? ''} placeholder="Cluster label in this datasource" onChange={event => {
          setDraft({ ...draft, public_scope: { ...draft.public_scope, cluster: event.target.value } }); 
        }} /></Input.Root></label><small><code>{'{{cluster}}'}</code></small></div>
      </div>
      <footer className="grafana-provider-foot">Read-only <span className="grafana-spacer" /><Button size="sm" variant="ghost" onClick={() => {
        try {
          navigateActivePage('/_plugin/grafana'); 
        } catch (err) {
          setError(String(err)); 
        } 
      }}>Manage Grafana connections</Button></footer>
    </section>
    <div className="grafana-mapping-heading"><strong>Metric mappings {applicableDefinitions.length}</strong><span className="grafana-badge grafana-badge-override">{applicableOverrideCount} cluster {applicableOverrideCount === 1 ? 'override' : 'overrides'}</span></div>
    <div className="grafana-mapping-toolbar"><Input.Root className="grafana-input" size="md"><Input.Control aria-label="Search connection mappings" placeholder="Search mappings…" value={search} onChange={event => {
      setSearch(event.target.value); 
    }} /></Input.Root><span className="grafana-spacer" /><small>Global defaults + cluster overrides</small></div>
    {applicableDefinitions.map(global => {
      const override = draft.overrides.find(value => value.metric_id === global.id);
      const effective = resolveDefinition(global, override);
      return <details hidden={![global.name, ...global.resource_keys, effective.query].join(' ').toLowerCase().includes(search.toLowerCase())} className="grafana-mapping" key={global.id}><summary><span className="grafana-mapping-row"><strong>{global.name}</strong><span className="grafana-resource">{global.resource_keys.map(key => key.split('/').pop()).join(', ')}</span><span className="grafana-badge">{global.unit}</span><span className="grafana-spacer" /><span className={`grafana-badge ${override ? 'grafana-badge-override' : ''}`}>{override ? 'Cluster override' : 'Inherited'}</span><span className="grafana-override-action">{override ? 'Edit override' : 'Override'}</span></span><QueryPreview query={effective.query} /></summary>
        <MappingEditor key={JSON.stringify([effective, draft.source, editorEpoch])} definition={effective} connectionID={draft.source.connection_id} datasourceUID={draft.source.datasource_uid} schemaContext={{ pluginID: resourcePluginID, connectionID, resourceType: global.resource_keys.includes(sampleType) ? sampleType : global.resource_keys[0] }} sampleRequest={sample && global.resource_keys.includes(sample.reference.address.type) ? sampleRequest : undefined} inherited={!override} onDraft={onMappingDraft} onReset={override ? () => {
          setDraft(resetOverride(draft, global.id)); onMappingDraft(global.id, undefined); setEditorEpoch(value => value + 1); 
        } : undefined} onSave={async value => {
          setDraft(stageDefinition(draft, global, value));
          onMappingDraft(global.id, undefined);
          setStatus('Mapping staged');
        }} />
      </details>;
    })}
    <details className="grafana-sample-context"><summary>Query test resource</summary>
      <label>Sample resource type<MetricsSelect label="Sample resource type" value={sampleType} onChange={value => {
        setSample(undefined); setSampleType(value); 
      }} options={resourceTypes.map(type => ({ value: type, label: type }))} /></label>
      {sampleType && <SampleResource key={sampleType} pluginID={resourcePluginID} connectionID={connectionID} resourceKey={sampleType} onSelect={setSample} />}
    </details>
    {saved && <details className="grafana-sample-context"><summary>Binding actions</summary><Button size="sm" variant="ghost" color="danger" disabled={busy} onClick={async () => {
      setBusy(true); try {
        await MetricClient.DeleteMetricBinding(resourcePluginID, connectionID, saved.id); setSaved(undefined); setMappingDrafts({}); setEditorEpoch(value => value + 1); setDraft({ ...draft, source: { ...draft.source, connection_id: '', datasource_uid: '', datasource_kind: '' }, overrides: [], public_scope: {} }); setStatus('External binding removed. Native configuration preserved.'); 
      } catch (err) {
        setError(String(err)); 
      } finally {
        setBusy(false); 
      } 
    }}>Remove binding</Button></details>}
    <div className="grafana-binding-actions"><Text size="xs" role="status" aria-live="polite">{dirty ? (status === 'Mapping staged' ? 'Mapping staged · Unsaved changes' : 'Unsaved changes') : status || 'All changes saved'}</Text><span className="grafana-spacer" />
      <Button size="sm" variant="ghost" disabled={busy || !dirty} onClick={() => {
        setDraft(saved ?? { ...draft, source: { ...draft.source, connection_id: '', datasource_uid: '', datasource_kind: '' }, public_scope: {}, overrides: [] }); setMappingDrafts({}); setEditorEpoch(value => value + 1); setError(''); setStatus('Changes discarded'); 
      }}>Discard changes</Button>
      <Button size="sm" disabled={busy || !dirty || !draft.source.datasource_uid || !draft.public_scope.cluster} onClick={saveBinding}>Save connection metrics</Button>
    </div>
  </div>;
}
