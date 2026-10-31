import { Link, useLocation } from 'react-router';
import { Button, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { parseAppError, useConnectionProfiles } from '@omniviewdev/runtime';
import { connectionProfilePath, parsePagePath, resourceBrowserPath } from '@/features/workspace/pagePaths';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { reloadConnections } from '@/features/command-search/commands';

export default function ConnectionProfiles() {
  // Decode raw segments once: router params also rewrite literal encoded slashes.
  const target = parsePagePath(useLocation().pathname);
  const pluginID = target.kind === 'plugin' ? target.pluginId : '';
  const { profiles } = useConnectionProfiles({ pluginID });
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setError(undefined);
    setReloading(true);
    try {
      await reloadConnections(queryClient, pluginID);
      await profiles.refetch({ throwOnError: true });
    } catch (failure) {
      setError(failure);
    } finally {
      setReloading(false);
    }
  };

  if (profiles.isLoading) {
    return <Spinner size="xl" />; 
  }

  return <Stack direction="column" spacing={3}>
    <Text weight="semibold">Connection profiles</Text>
    <Text>Saved intent and last observed source inventory do not establish connection readiness.</Text>
    <Button disabled={reloading} onClick={async () => {
      await reload(); 
    }}>Reload source inventory</Button>
    {(profiles.isError || error !== undefined) && <Text tone="danger">{parseAppError(error ?? profiles.error).detail}</Text>}
    {(profiles.data ?? []).map((profile) => <Stack key={profile.id} direction="row" spacing={2}>
      <Text>{(profile.connection?.name ?? '') === '' ? profile.id : profile.connection?.name}: {profile.source}{profile.active ? ' (observed)' : ' (inactive)'}</Text>
      <Link to={connectionProfilePath(pluginID, profile.id)}>Review / edit profile</Link>
      {profile.active && <Link to={resourceBrowserPath(pluginID, profile.id)}>Browse resources</Link>}
    </Stack>)}
    {!profiles.isError && profiles.data?.length === 0 && <Text>No connection profiles.</Text>}
  </Stack>;
}
