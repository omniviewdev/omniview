import { Stack, Text } from '@omniviewdev/kit';
import {
  ActivityProvider,
  useConnectionReadiness,
  useConnections,
  useResolvedResourceTarget,
  useResourceTypes,
  useResources,
} from '@omniviewdev/runtime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { podNames } from './podNames';

const PLUGIN_ID = 'kubernetes';
const POD_TYPE = 'k8s:/pods';

type PodsProps = { readonly connectionID: string };

// The read chain the old screens use, unchanged: catalog -> resolved target -> collection source view.
// A connection is never started by a read, so the skeleton starts it once when it is found disconnected.
function Pods({ connectionID }: PodsProps) {
  const route = useMemo(() => ({ connection: connectionID }), [connectionID]);
  const readiness = useConnectionReadiness({ pluginID: PLUGIN_ID, connectionID });
  const { connect } = readiness;
  useEffect(() => {
    if (readiness.phase === 'disconnected') {
      void connect();
    }
  }, [readiness.phase, connect]);

  const { resourceTypes } = useResourceTypes({ pluginID: PLUGIN_ID, route });
  const podType = resourceTypes.data?.find((type) => type.type === POD_TYPE);
  const target = useResolvedResourceTarget({ pluginID: PLUGIN_ID, route, type: POD_TYPE, enabled: podType !== undefined });
  const request = target.data
    ? { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 500 } }
    : undefined;
  const { resources, isLive } = useResources({ pluginID: PLUGIN_ID, request, collection: true, live: true });
  const rows = podNames(resources.data?.records ?? []);

  return (
    <Stack gap={8}>
      <Text variant="title">Pods</Text>
      <Text tone="muted" data-testid="pods-status">
        {`${connectionID} · ${readiness.phase} · ${isLive ? 'live' : 'not live'} · ${rows.length} pods`}
      </Text>
      <Stack gap={4}>
        {rows.map((row) => (
          <Text key={row.key} data-testid="pod-name">{row.namespace === '' ? row.name : `${row.namespace}/${row.name}`}</Text>
        ))}
      </Stack>
    </Stack>
  );
}

function Connected() {
  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const wanted = new URLSearchParams(window.location.search).get('connection');
  const list = connections.data ?? [];
  const connection = list.find((candidate) => candidate.id === wanted) ?? list[0];

  if (connection === undefined) {
    return <Text tone="muted" data-testid="pods-status">{connections.isPending ? 'Loading connections' : 'No connections'}</Text>;
  }

  return <Pods key={connection.id} connectionID={connection.id} />;
}

export function PodsSkeleton() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ActivityProvider>
        <Stack pad={24}>
          <Connected />
        </Stack>
      </ActivityProvider>
    </QueryClientProvider>
  );
}
