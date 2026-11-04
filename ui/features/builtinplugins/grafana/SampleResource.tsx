import React, { useEffect, useMemo, useState } from 'react';
import { useResolvedResourceTarget, useResources, type HostRecord, type MetricResource } from '@omniviewdev/runtime';

/** Resource owner provides exact type. Catalog selection never grants query authority. */
export default function SampleResource({ pluginID, connectionID, resourceKey, onSelect }: {
  pluginID: string; connectionID: string; resourceKey: string; onSelect: (resource: MetricResource | undefined) => void;
}) {
  const [selected, setSelected] = useState('');
  const target = useResolvedResourceTarget({ pluginID, route: { connection: connectionID }, type: resourceKey });
  const { acquired, sourceError } = useResources({ pluginID, collection: true, request: target.data ? { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 100 } } : undefined });
  const records = acquired?.page.records;
  const resource = useMemo(() => {
    const record: HostRecord | undefined = records?.find(record => record.key === selected);
    if (!record) return undefined;
    return { token: record.key, resource_key: record.record.reference.address.type, resource_id: record.record.reference.address.id,
      resource_namespace: record.record.reference.address.scope.find(value => value.dimension === 'namespace')?.value ?? '', reference: record.record.reference,
      route: record.route } satisfies MetricResource;
  }, [records, selected, resourceKey]);
  useEffect(() => { onSelect(resource); }, [resource, onSelect]);
  return <label>Real sample resource<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose an admitted resource for Test query</option>{records?.map(record => <option key={record.key} value={record.key}>{record.record.reference.address.scope.find(value => value.dimension === 'namespace')?.value ?? ''}/{record.record.reference.address.id}</option>)}</select>{sourceError && <span role="alert">Resource catalog unavailable: {String(sourceError)}</span>}</label>;
}
