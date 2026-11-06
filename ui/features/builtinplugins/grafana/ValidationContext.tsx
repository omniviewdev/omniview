import { useEffect, useState } from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useConnections, type ResourceMetricTarget } from '@omniviewdev/runtime';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import SampleResource from './SampleResource';
import type { MappingSchemaContext } from './SchemaFieldPicker';
import { MetricsSelect } from './DatasourceSelector';
export type ValidationSample = { context: MappingSchemaContext; resource?: ResourceMetricTarget };
export default function ValidationContext({ resourceTypes, onChange }: { resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void }) {
  const { plugins } = usePluginManager();
  const [owner, setOwner] = useState('');
  return <fieldset><legend>Temporary validation context</legend><Text size="xs">Used only for schema discovery and admitted sample queries. This does not create a resource binding.</Text>
    <label>Resource owner<MetricsSelect label="Resource owner" value={owner} onChange={value => {
      setOwner(value); onChange(undefined); 
    }} options={[{ value: '', label: 'Choose loaded resource owner' }, ...(plugins.data ?? []).map(plugin => ({ value: plugin.id, label: plugin.metadata.name }))]} /></label>
    {owner && <OwnerContext key={owner} owner={owner} resourceTypes={resourceTypes} onChange={onChange} />}
  </fieldset>;
}

function OwnerContext({ owner, resourceTypes, onChange }: { owner: string; resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void }) {
  const { connections } = useConnections({ plugin: owner });
  const [connection, setConnection] = useState('');
  const [resourceType, setResourceType] = useState(resourceTypes[0] ?? '');
  const [resource, setResource] = useState<ResourceMetricTarget>();
  useEffect(() => {
    onChange(connection && resourceType ? { context: { pluginID: owner, connectionID: connection, resourceType }, resource } : undefined); 
  }, [owner, connection, resourceType, resource, onChange]);
  return <><label>Resource connection<MetricsSelect label="Resource connection" value={connection} onChange={value => {
    setResource(undefined); setConnection(value); 
  }} options={[{ value: '', label: 'Choose resource connection' }, ...(connections.data ?? []).map(value => ({ value: value.id, label: value.name || value.id }))]} /></label>
  <label>Resource type<MetricsSelect label="Resource type" value={resourceType} onChange={value => {
    setResource(undefined); setResourceType(value); 
  }} options={resourceTypes.map(value => ({ value, label: value }))} /></label>
  {connection && resourceType && <SampleResource key={JSON.stringify([owner, connection, resourceType])} pluginID={owner} connectionID={connection} resourceKey={resourceType} onSelect={setResource} />}
  </>;
}
