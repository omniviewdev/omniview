import { useEffect, useMemo, useState } from 'react';
import { parseAppError, useResolvedResourceTarget, useResources, type HostRecord, type ResourceMetricTarget } from '@omniviewdev/runtime';
import { MetricsSelect } from './DatasourceSelector';

/** Resource owner provides exact type. Catalog selection never grants query authority. */
export default function SampleResource({ pluginID, connectionID, resourceKey, onSelect }: {
  pluginID: string; connectionID: string; resourceKey: string; onSelect: (resource: ResourceMetricTarget | undefined) => void;
}) {
  const [selected, setSelected] = useState('');
  const target = useResolvedResourceTarget({ pluginID, route: { connection: connectionID }, type: resourceKey });
  const { acquired, resources, source, sourceError, isSyncing } = useResources({ pluginID, collection: true, live: false, request: target.data ? { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 100 } } : undefined });
  const records = acquired?.page.records;
  const failure = source?.error ?? resources.error ?? target.error;
  const error = failure ? parseAppError(failure) : undefined;
  const resource = useMemo(() => {
    const record: HostRecord | undefined = records?.find(record => record.key === selected);
    if (!record) {
      return undefined;
    }

    return { token: record.key, reference: record.record.reference, route: record.route } satisfies ResourceMetricTarget;
  }, [records, selected]);
  useEffect(() => {
    onSelect(resource); 
  }, [resource, onSelect]);
  return <label>Real sample resource<MetricsSelect label="Real sample resource" value={selected} onChange={setSelected} options={[{ value: '', label: 'Choose an admitted resource for Test query' }, ...(records ?? []).map(record => ({ value: record.key, label: [...record.record.reference.address.scope.map(value => `${value.dimension}=${value.value}`), record.record.reference.address.id].join(' / ') }))]} />
    {(target.isLoading || resources.isLoading || isSyncing) && <span role="status">Loading resource snapshot…</span>}
    {(error ?? sourceError) && <span role="alert">Resource catalog unavailable: {error ? `${error.title}${error.code ? ` (${error.code})` : ''}: ${error.detail}` : 'Source view failed without an error detail.'}</span>}
  </label>;
}
