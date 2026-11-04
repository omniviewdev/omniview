import React from 'react';
import { Input, Text } from '@omniviewdev/base-ui';
import type { MetricDataSource } from '@omniviewdev/runtime';

/** Discovery is optional. Backend admission validates every selected UID and datasource kind. */
export default function DatasourceSelector({ sources, value, onChange, disabled, catalogError }: {
  sources: MetricDataSource[]; value: string; onChange: (uid: string) => void; disabled?: boolean; catalogError?: string;
}) {
  return <>
    {catalogError && <p role="alert">Datasource discovery unavailable: {catalogError}. Enter a known Prometheus datasource UID manually.</p>}
    <label>Discovered datasources<select disabled={disabled} value={sources.some(source => source.uid === value) ? value : ''} onChange={event => onChange(event.target.value)}><option value="">Choose discovered datasource</option>{sources.filter(source => source.kind === 'prometheus').map(source => <option key={source.uid} value={source.uid}>{source.name} · {source.uid}</option>)}</select></label>
    <label>Prometheus datasource UID<Input.Control disabled={disabled} value={value} onChange={event => onChange(event.target.value)} placeholder="Enter datasource UID, or direct for a direct endpoint" /></label>
    <Text size="xs">Manual UIDs do not require catalog-list permission. Save or Test query verifies the selected datasource; discovery alone does not.</Text>
  </>;
}
