import React, { useState } from 'react';
import { Button, Input, Text, Stack } from '@omniviewdev/base-ui';
import { useSchemaFields } from '@omniviewdev/runtime';

type Segment = Parameters<typeof useSchemaFields>[0]['path'][number];
export interface MappingSchemaContext { pluginID: string; connectionID: string; resourceType: string }
export function schemaPointer(segments: readonly string[]): string {
  return '/' + segments.map(segment => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/** Schema navigation and concrete map keys stay separate; no wildcard or executable path is accepted. */
export default function SchemaFieldPicker({ context, value, onSelect }: {
  context: MappingSchemaContext; value: string; onSelect: (pointer: string) => void;
}) {
  const [path, setPath] = useState<Segment[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [mapKey, setMapKey] = useState('');
  const schema = useSchemaFields({ pluginID: context.pluginID, route: { connection: context.connectionID }, type: context.resourceType, path });
  return <Stack direction="column" spacing={1}>
    <Text size="xs">Selected path: {value || 'None'} · {context.resourceType}</Text>
    <Text size="xs">Schema path: {names.length ? schemaPointer(names) : '/'}</Text>
    {names.length > 0 && <Button size="sm" onClick={() => { setNames(names.slice(0, -1)); setPath(path.slice(0, -1)); }}>Parent field</Button>}
    {schema.error && <p role="alert">Schema unavailable: {String(schema.error)}</p>}
    {schema.result && schema.result.schemaState !== 'available' && <p role="status">No authoritative schema available. Arbitrary resource paths cannot be selected.</p>}
    {schema.fields.map((field, index) => {
      const concrete = field.Segment.Kind === 'field' ? field.Segment.Name ?? '' : mapKey;
      const scalar = Boolean(field.Types?.length && field.Types.every(type => ['string', 'boolean', 'integer', 'number'].includes(type)));
      if (field.Segment.Kind === 'item') return null;
      return <div key={index}>
        {field.Segment.Kind === 'mapValue' && <label>Exact map key<Input.Control value={mapKey} onChange={event => setMapKey(event.target.value)} placeholder="e.g. topology.kubernetes.io/zone" /></label>}
        <Button size="sm" disabled={!concrete || (!scalar && !field.HasChildren)} onClick={() => {
          if (scalar) onSelect(schemaPointer([...names, concrete]));
          else { setNames([...names, concrete]); setPath([...path, field.Segment]); setMapKey(''); }
        }}>{field.Segment.Name || 'Map entry'} · {field.Types?.join(' | ') || 'unknown'} · {field.Presence}{field.HasChildren && !scalar ? ' →' : ''}</Button>
        {field.Description && <Text size="xs">{field.Description}</Text>}
      </div>;
    })}
    {schema.result?.truncated && <Text size="xs">Schema results truncated. Navigate a narrower object.</Text>}
    <Text size="xs">Only selected scalar leaves reach the provider. Required fields missing from a real resource fail query validation.</Text>
  </Stack>;
}
