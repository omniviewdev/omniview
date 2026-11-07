import { useState } from 'react';
import { Button, Input, Text, Stack } from '@omniviewdev/base-ui';
import { useSchemaFields } from '@omniviewdev/runtime';

type Segment = Parameters<typeof useSchemaFields>[0]['path'][number];
export type MappingSchemaContext = { pluginID: string; connectionID: string; resourceType: string };
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
  const [open, setOpen] = useState(false);
  const schema = useSchemaFields({ pluginID: context.pluginID, route: { connection: context.connectionID }, type: context.resourceType, path, enabled: open });
  return <Stack direction="column" spacing={1} style={{ minWidth: 0 }}>
    <Stack direction="row" align="center" justify="between" spacing={1}>
      <Text size="xs" truncate title={`${context.resourceType}: ${value || 'Canonical identity'}`} style={{ fontFamily: 'var(--ov-font-mono)' }}>{value || 'Canonical identity'}</Text>
      <Button size="sm" variant="ghost" aria-label="Browse schema fields" aria-expanded={open} onClick={() => {
        setOpen(!open); 
      }}>{open ? 'Close' : 'Browse'}</Button>
    </Stack>
    {open && <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--ov-color-border-default)', borderRadius: 4, padding: 8 }}>
      <Stack direction="row" align="center" justify="between" spacing={1} style={{ marginBottom: 4 }}>
        <Text size="xs" truncate title={context.resourceType}>Schema path: {names.length ? schemaPointer(names) : '/'}</Text>
        {names.length > 0 && <Button size="sm" variant="ghost" onClick={() => {
          setNames(names.slice(0, -1)); setPath(path.slice(0, -1)); 
        }}>Parent field</Button>}
      </Stack>
      {schema.error && <p role="alert">Schema unavailable: {String(schema.error)}</p>}
      {schema.result && schema.result.schemaState !== 'available' && <Text size="xs" role="status">Authoritative schema unavailable.</Text>}
      {schema.fields.map((field, index) => {
        const concrete = field.Segment.Kind === 'field' ? field.Segment.Name ?? '' : mapKey;
        const scalar = Boolean(field.Types?.length && field.Types.every(type => ['string', 'boolean', 'integer', 'number'].includes(type)));
        const name = field.Segment.Name ?? '';
        const types = field.Types?.join(' | ') ?? '';
        if (field.Segment.Kind === 'item') {
          return null;
        }

        return <div key={index} style={{ marginBlock: 2 }}>
          {field.Segment.Kind === 'mapValue' && <label>Exact map key<Input.Root className="grafana-input" size="md"><Input.Control value={mapKey} onChange={event => {
            setMapKey(event.target.value); 
          }} placeholder="e.g. topology.kubernetes.io/zone" /></Input.Root></label>}
          <Button size="sm" variant="ghost" title={field.Description || undefined} disabled={!concrete || (!scalar && !field.HasChildren)} onClick={() => {
            if (scalar) {
              onSelect(schemaPointer([...names, concrete])); setOpen(false); 
            } else {
              setNames([...names, concrete]); setPath([...path, field.Segment]); setMapKey(''); 
            }
          }}>{name.length > 0 ? name : 'Map entry'} · {types.length > 0 ? types : 'unknown'} · {field.Presence}{field.HasChildren && !scalar ? ' →' : ''}</Button>
        </div>;
      })}
      {schema.result?.truncated && <Text size="xs">Schema results truncated. Navigate a narrower object.</Text>}
    </div>}
  </Stack>;
}
