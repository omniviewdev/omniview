import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { ConnectionBoundary, ConnectionBoundaryFallback, parseAppError, useConnection, useResourceGroups, useResourceTypes } from '@omniviewdev/runtime';
import ResourceTable from '@/components/tables/Resources';
import Icon from '@/components/icons/Icon';
import { connectionProfilePath, connectionProfilesPath, parsePagePath } from '@/features/workspace/pagePaths';

/** Workspace-owned browser; provider type IDs remain opaque in both state and URLs. */
export default function ResourceBrowser() {
  // Decode raw segments once: router params also rewrite literal encoded slashes.
  const target = parsePagePath(useLocation().pathname);
  const pluginID = target.kind === 'connection' ? target.pluginId : '';
  const connectionID = target.kind === 'connection' ? target.connectionId : '';
  const navigate = useNavigate();
  return <ConnectionBoundary pluginID={pluginID} connectionID={connectionID} fallback={(state) =>
    <ConnectionBoundaryFallback state={state}
      onEditConnection={async () => {
        await navigate(connectionProfilePath(pluginID, connectionID)); 
      }}
      onBack={async () => {
        await navigate(connectionProfilesPath(pluginID)); 
      }} />
  }>
    <ConnectedResourceBrowser key={JSON.stringify([pluginID, connectionID])} pluginID={pluginID} connectionID={connectionID} />
  </ConnectionBoundary>;
}

function ConnectedResourceBrowser({ pluginID, connectionID }: { pluginID: string; connectionID: string }) {
  const route = { connection: connectionID };
  const { connection } = useConnection({ pluginID, connectionID });
  const { resourceTypes } = useResourceTypes({ pluginID, route });
  const { groups } = useResourceGroups({ pluginID, route });
  const [search, setSearch] = useSearchParams();
  const selected = search.get('type');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groupsFailed = groups.isError && parseAppError(groups.error).code !== 'UNSUPPORTED';
  if (connection.isError || resourceTypes.isError || groupsFailed) {
    return <Text tone="danger">{parseAppError(connection.error ?? resourceTypes.error ?? groups.error).detail}</Text>;
  }

  if (connection.isLoading || resourceTypes.isLoading || groups.isLoading) {
    return <Spinner size="xl" />; 
  }

  const types = resourceTypes.data ?? [];
  const byType = new Map(types.map((type) => [type.type, type]));
  const grouped = new Set(groups.data?.flatMap((group) => group.resources) ?? []);
  const select = (type: string) => {
    const next = new URLSearchParams(search);
    next.set('type', type);
    setSearch(next);
  };

  const item = (type: string) => <Button key={type} variant={selected === type ? 'soft' : 'ghost'} onClick={() => {
    select(type); 
  }}>
    {byType.get(type)?.displayName ? byType.get(type)?.displayName : type}
  </Button>;
  return <Stack direction="row" spacing={4} style={{ height: '100%', minHeight: 0 }}>
    <nav aria-label="Resource types" style={{ width: 300, overflow: 'auto', flexShrink: 0 }}>
      <Stack direction="column" spacing={2}>
        <Text weight="semibold">{(connection.data?.name ?? '') === '' ? connectionID : connection.data?.name}</Text>
        <Link to={connectionProfilePath(pluginID, connectionID)}>Edit connection profile</Link>
        <Link to={connectionProfilesPath(pluginID)}>Connection profiles</Link>
        {(groups.data ?? []).map((group) => <section key={group.id}>
          <Button variant="ghost" aria-expanded={(expanded[group.id] ?? true)} onClick={() => {
            setExpanded((state) => ({ ...state, [group.id]: !(state[group.id] ?? true) })); 
          }}>
            {group.icon && <Icon name={group.icon} size={16} />}{group.name}
          </Button>
          {(expanded[group.id] ?? true) && <Stack direction="column">{group.resources.filter((type) => byType.has(type)).map(item)}</Stack>}
        </section>)}
        {types.filter((type) => !grouped.has(type.type)).map((type) => item(type.type))}
        {types.length === 0 && <Text>No resource types are advertised.</Text>}
      </Stack>
    </nav>
    <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
      {selected && byType.has(selected)
        ? <ResourceTable key={selected} pluginID={pluginID} connectionID={connectionID} resourceKey={selected} />
        : <Text>{selected ? 'Resource type is no longer advertised.' : 'Select a resource type.'}</Text>}
    </div>
  </Stack>;
}
