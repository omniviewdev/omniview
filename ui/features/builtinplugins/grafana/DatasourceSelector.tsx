import { Input, Select } from '@omniviewdev/base-ui';
import type { MetricDataSource } from '@omniviewdev/runtime';

export function MetricsSelect({ value, onChange, options, disabled, label }: {
  value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean; label: string;
}) {
  return <Select.Root value={value} onValueChange={next => onChange(next ?? '')} disabled={disabled} size="sm">
    <Select.Trigger aria-label={label} className="grafana-select"><Select.Value>{options.find(option => option.value === value)?.label ?? value}</Select.Value><Select.Icon /></Select.Trigger>
    <Select.Portal><Select.Positioner><Select.Popup><Select.List>{options.map(option =>
      <Select.Item key={option.value} value={option.value}>{option.label}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
  </Select.Root>;
}
/** Discovery is optional. Backend admission validates every selected UID and datasource kind. */
export default function DatasourceSelector({ sources, value, onChange, disabled, catalogError }: {
  sources: MetricDataSource[]; value: string; onChange: (uid: string) => void; disabled?: boolean; catalogError?: string;
}) {
  const selected = sources.find(source => source.uid === value);
  return <div className="grafana-datasource">
    <label>Data source<MetricsSelect label="Discovered datasources" disabled={disabled} value={selected ? value : ''} onChange={onChange}
      options={[{ value: '', label: 'Choose data source' }, ...sources.filter(source => source.kind === 'prometheus').map(source => ({ value: source.uid, label: source.name }))]} /></label>
    {selected && <small>Prometheus <span>UID: {selected.uid}</span></small>}
    <details className="grafana-manual-source" open={Boolean(catalogError) || Boolean(value && !selected)}><summary>Enter datasource UID</summary>
      {catalogError && <p role="alert">Datasource discovery unavailable: {catalogError}</p>}
      <label>Prometheus datasource UID<Input.Root className="grafana-input" size="md"><Input.Control disabled={disabled} value={value} onChange={event => onChange(event.target.value)} placeholder="Datasource UID, or direct" /></Input.Root></label>
    </details>
  </div>;
}
