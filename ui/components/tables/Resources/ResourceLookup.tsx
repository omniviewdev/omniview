import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { parseAppError, valueToJSONText, type ResourceType } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';

type Props = { pluginID: string; connectionID: string; resourceKey: string; resourceType: ResourceType };

const ResourceLookup = ({ pluginID, connectionID, resourceKey, resourceType }: Props) => {
  const [representation, setRepresentation] = useState('');
  const [lookupID, setLookupID] = useState('');
  const [readID, setReadID] = useState('');
  const [identityScope, setIdentityScope] = useState<Record<string, string>>({});
  const selectedRepresentation = representation !== '' ? representation : resourceType.defaultRepresentation ?? '';
  const lookup = useQuery({
    queryKey: [pluginID, 'resource-table-get', connectionID, resourceKey, selectedRepresentation, readID, identityScope],
    enabled: readID !== '' && selectedRepresentation !== '',
    retry: false,
    queryFn: async () => {
      const resolved = await ResourceClient.ResolveReference(pluginID, {
        route: { connection: connectionID }, type: resourceKey, id: readID,
        scope: resourceType.identityDimensions.map(({ name }) => ({ dimension: name, value: identityScope[name] ?? '' })),
        representation: selectedRepresentation,
      });
      return ResourceClient.Get(pluginID, { targetId: resolved.targetId, request: {
        route: resolved.route, reference: resolved.reference, representation: resolved.representation,
      } });
    },
  });
  return <Stack direction="column" spacing={2}>
    <Text>{resourceType.displayName || resourceKey}: Look up a resource by its canonical ID and identity scope.</Text>
    <select aria-label="Resource representation" value={selectedRepresentation} onChange={(event) => {
      setRepresentation(event.target.value); 
    }}>
      <option value="">Select representation</option>
      {resourceType.representations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
    </select>
    <input aria-label="Resource ID" value={lookupID} onChange={(event) => {
      setLookupID(event.target.value); 
    }} />
    {resourceType.identityDimensions.map(({ name }) => <label key={name}>{name}<input aria-label={`Identity scope ${name}`} value={identityScope[name] ?? ''} onChange={(event) => {
      setReadID('');
      setIdentityScope((current) => ({ ...current, [name]: event.target.value }));
    }} /></label>)}
    <Button disabled={!selectedRepresentation} onClick={() => {
      setReadID(lookupID); 
    }}>Get resource</Button>
    {lookup.isFetching && <Spinner />}
    {lookup.isError && <Text tone="danger">{parseAppError(lookup.error).detail}</Text>}
    {lookup.data && <pre>{valueToJSONText(lookup.data.record.body)}</pre>}
  </Stack>;
};

export default ResourceLookup;
