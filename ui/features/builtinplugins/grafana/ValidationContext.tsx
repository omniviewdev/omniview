import { useEffect, useState } from 'react'
import { Input, Text } from '@omniviewdev/base-ui';
import { useConnections, type MetricResource } from '@omniviewdev/runtime';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import SampleResource from './SampleResource';
import type { MappingSchemaContext } from './SchemaFieldPicker';
export interface ValidationSample { context: MappingSchemaContext; resource?: MetricResource; cluster: string }
export default function ValidationContext({ resourceTypes, onChange }: { resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void }) {
  const { plugins } = usePluginManager();
  const [owner, setOwner] = useState('');
  return <fieldset><legend>Temporary validation context</legend><Text size="xs">Used only for schema discovery and admitted sample queries. This does not create a resource binding.</Text>
    <label>Resource owner<select value={owner} onChange={event => { setOwner(event.target.value); onChange(undefined); }}><option value="">Choose loaded resource owner</option>{plugins.data?.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.metadata.name}</option>)}</select></label>
    {owner && <OwnerContext key={owner} owner={owner} resourceTypes={resourceTypes} onChange={onChange} />}
  </fieldset>;
}
function OwnerContext({ owner, resourceTypes, onChange }: { owner: string; resourceTypes: string[]; onChange: (sample: ValidationSample | undefined) => void }) {
  const { connections } = useConnections({ plugin: owner });
  const [connection, setConnection] = useState('');
  const [resourceType, setResourceType] = useState(resourceTypes[0] ?? '');
  const [resource, setResource] = useState<MetricResource>();
  const [cluster, setCluster] = useState('');
  useEffect(() => { onChange(connection && resourceType ? { context: { pluginID: owner, connectionID: connection, resourceType }, resource, cluster } : undefined); }, [owner, connection, resourceType, resource, cluster, onChange]);
  return <><label>Resource connection<select value={connection} onChange={event => { setResource(undefined); setConnection(event.target.value); }}><option value="">Choose resource connection</option>{connections.data?.map(value => <option key={value.id} value={value.id}>{value.name || value.id}</option>)}</select></label>
    <label>Resource type<select value={resourceType} onChange={event => { setResource(undefined); setResourceType(event.target.value); }}>{resourceTypes.map(type => <option key={type}>{type}</option>)}</select></label>
    <label>Sample public cluster scope<Input.Control value={cluster} onChange={event => setCluster(event.target.value)} /></label>
    {connection && resourceType && <SampleResource key={JSON.stringify([owner, connection, resourceType])} pluginID={owner} connectionID={connection} resourceKey={resourceType} onSelect={setResource} />}
  </>;
}
