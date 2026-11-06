import { useEffect, useState } from 'react';
import { PluginContextProvider, useConnections, parseAppError, type ResourceMetricTarget } from '@omniviewdev/runtime';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import SampleResource from './SampleResource';
import type { MappingSchemaContext } from './SchemaFieldPicker';
import { MetricsSelect } from './DatasourceSelector';
export type ValidationSample = { context: MappingSchemaContext; resource?: ResourceMetricTarget };
export default function ValidationContext({ resourceTypes, onChange, lockOwner = false }: { resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void; lockOwner?: boolean }) {
  const { plugins } = usePluginManager();
  const [owner, setOwner] = useState('');
  return <fieldset title={lockOwner ? 'Save or discard mapping changes before changing the resource owner.' : undefined}><legend>Resource context</legend>
    <label>Resource owner<MetricsSelect label="Resource owner" value={owner} disabled={lockOwner} onChange={value => {
      setOwner(value); onChange(undefined); 
    }} options={[{ value: '', label: 'Choose loaded resource owner' }, ...(plugins.data ?? []).map(plugin => ({ value: plugin.id, label: plugin.metadata.name }))]} /></label>
    {owner && <PluginContextProvider pluginId={owner}><OwnerContext key={owner} owner={owner} resourceTypes={resourceTypes} onChange={onChange} lockOwner={lockOwner} /></PluginContextProvider>}
  </fieldset>;
}

function OwnerContext({ owner, resourceTypes, onChange, lockOwner }: { owner: string; resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void; lockOwner: boolean }) {
  const { connections } = useConnections({ plugin: owner });
  const [connection, setConnection] = useState('');
  const [resourceType, setResourceType] = useState(resourceTypes[0] ?? '');
  const [resource, setResource] = useState<ResourceMetricTarget>();
  useEffect(() => {
    onChange(connection ? { context: { pluginID: owner, connectionID: connection, resourceType }, resource } : undefined);
  }, [owner, connection, resourceType, resource, onChange]);
  return <><label>Resource connection<MetricsSelect label="Resource connection" value={connection} disabled={lockOwner} onChange={value => {
    setResource(undefined); setConnection(value); 
  }} options={[{ value: '', label: 'Choose resource connection' }, ...(connections.data ?? []).map(value => ({ value: value.id, label: value.name || value.id }))]} /></label>
  {connections.error && <span role="alert">{parseAppError(connections.error).title}</span>}
  <label>Resource type<MetricsSelect label="Resource type" value={resourceType} onChange={value => {
    setResource(undefined); setResourceType(value); 
  }} options={[{ value: '', label: 'Choose resource type' }, ...resourceTypes.map(value => ({ value, label: value }))]} /></label>
  {connection && resourceType && <SampleResource key={JSON.stringify([owner, connection, resourceType])} pluginID={owner} connectionID={connection} resourceKey={resourceType} onSelect={setResource} />}
  </>;
}
