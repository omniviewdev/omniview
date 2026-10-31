import React from 'react';
import { Avatar, Banner, Button, Grid, Stack, Text, TextArea, TextField } from '@omniviewdev/base-ui';
import { parseAppError, useConnection, useConnectionProfiles, type AppError } from '@omniviewdev/runtime';
import { Connection } from '@omniviewdev/runtime/models';
import { useLocation } from 'react-router';
import { parsePagePath } from '@/features/workspace/pagePaths';

function ProfileEditor({ connection, pending, onSave, onDraftChange }: {
  connection: Connection;
  pending: boolean;
  onSave: (name: string, description: string, configuration: string) => Promise<void>;
  onDraftChange: () => void;
}) {
  const [name, setName] = React.useState(connection.name);
  const [description, setDescription] = React.useState(connection.description);
  const [configuration, setConfiguration] = React.useState(JSON.stringify(connection.data ?? {}, null, 2));
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      await onSave(name, description, configuration);
    }}>
      <Grid columns={12} spacing={4}>
        <Grid.Item span={12}>
          <Stack direction="row" spacing={2} align="center">
            <Avatar size="lg" src={connection.avatar} name={name} />
            <TextField.Root>
              <TextField.Control aria-label="Connection name" value={name} onChange={(event) => {
                setName(event.target.value);
                onDraftChange();
              }} disabled={pending} />
            </TextField.Root>
          </Stack>
        </Grid.Item>
        <Grid.Item span={12}>
          <TextArea.Root>
            <TextArea.Control aria-label="Connection description" rows={3} value={description} onChange={(event) => {
              setDescription(event.target.value);
              onDraftChange();
            }} disabled={pending} />
          </TextArea.Root>
        </Grid.Item>
        <Grid.Item span={12}>
          <Text>Desired source configuration (JSON)</Text>
          <TextArea.Root>
            <TextArea.Control aria-label="Desired source configuration" rows={10} value={configuration} onChange={(event) => {
              setConfiguration(event.target.value);
              onDraftChange();
            }} disabled={pending} />
          </TextArea.Root>
        </Grid.Item>
        <Grid.Item span={12}>
          <Button type="submit" disabled={pending}>{pending ? 'Applying…' : 'Save and apply'}</Button>
        </Grid.Item>
      </Grid>
    </form>
  );
}

export default function ConnectionDetails(): React.ReactElement {
  // Decode raw segments once: router params also rewrite literal encoded slashes.
  const target = parsePagePath(useLocation().pathname);
  const pluginID = target.kind === 'connection' ? target.pluginId : '';
  const connectionID = target.kind === 'connection' ? target.connectionId : '';
  return <ConnectionDetailsForTarget key={JSON.stringify([pluginID, connectionID])} pluginID={pluginID} connectionID={connectionID} />;
}

function ConnectionDetailsForTarget({ pluginID, connectionID }: { pluginID: string; connectionID: string }): React.ReactElement {
  const { profiles } = useConnectionProfiles({ pluginID });
  const profile = profiles.data?.find((entry) => entry.id === connectionID);
  const { connection, saveConnectionProfile, importConnectionProfile, resetConnectionProfile, removeConnection } = useConnection({
    pluginID, connectionID, enabled: profile?.active === true,
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<AppError | null>(null);
  const [saved, setSaved] = React.useState(false);
  const operation = React.useRef(0);
  React.useEffect(() => {
    return () => {
      operation.current += 1; 
    };
  }, []);

  const apply = async (change: () => Promise<unknown>) => {
    const current = ++operation.current;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await change();
      if (current === operation.current) {
        setSaved(true); 
      }
    } catch (failure) {
      if (current === operation.current) {
        setError(parseAppError(failure)); 
      }
    } finally {
      if (current === operation.current) {
        setPending(false); 
      }
    }
  };

  if (profiles.isLoading) {
    return <Text>Loading connection profile…</Text>; 
  }

  if (profiles.isError) {
    return <Text tone="danger">{parseAppError(profiles.error).detail}</Text>; 
  }

  return (
    <Stack direction="column" spacing={4}>
      <Text weight="semibold">Desired profile: {profile?.source ?? 'absent'}</Text>
      <Text>Last observed source inventory: {profile?.active ? 'available' : 'not available'}. This is not connection readiness.</Text>
      {profile?.source === 'review' && <Banner color="warning">This saved discovery entry is inactive. Review it before explicitly importing or saving it.</Banner>}
      {profile?.source === 'disabled' && <Banner color="warning">Disabled in Omniview. Native configuration files have not been changed.</Banner>}
      {error && <Banner color="danger"><Banner.Content><Banner.Title>Connection change failed{error.code ? ` (${error.code})` : ''}</Banner.Title>{error.detail}</Banner.Content></Banner>}
      {saved && <Banner color="success">Source change applied and desired configuration saved.</Banner>}
      {profile?.connection && <ProfileEditor
        key={`${pluginID}/${connectionID}/${profile.source}`}
        connection={profile.connection}
        pending={pending}
        onDraftChange={() => {
          setSaved(false); 
        }}
        onSave={async (name, description, configuration) => {
          await apply(async () => {
            const data: unknown = JSON.parse(configuration);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
              throw new Error('Source configuration must be a JSON object.');
            }

            await saveConnectionProfile(Connection.createFrom({ ...profile.connection, name, description, data }));
          });
        }}
      />}
      {!profile && <Text>No desired or native connection configuration exists for this ID.</Text>}
      <Stack direction="row" spacing={2}>
        {profile?.source === 'review' && <Button disabled={pending} onClick={async () => {
          await apply(importConnectionProfile); 
        }}>Import reviewed profile</Button>}
        {profile && profile.source !== 'native' && profile.source !== 'review' && profile.source !== 'absent' && <Button disabled={pending} onClick={async () => {
          await apply(resetConnectionProfile); 
        }}>Reset / restore native configuration</Button>}
        {profile && profile.source !== 'disabled' && profile.source !== 'review' && profile.source !== 'absent' && <Button color="danger" disabled={pending} onClick={async () => {
          await apply(removeConnection); 
        }}>{profile.source === 'manual' ? 'Delete saved profile' : 'Disable in Omniview'}</Button>}
      </Stack>
      <details>
        <summary>Last observed effective source configuration</summary>
        {error?.code === 'RESET_REQUIRED' ? <Text tone="danger">Actual source state is unknown.</Text>
          : connection.isError ? <Text tone="danger">{parseAppError(connection.error).detail}</Text>
            : connection.isLoading || connection.isFetching ? <Text>Loading effective configuration…</Text>
              : profile?.active && connection.data ? <pre>{JSON.stringify(connection.data, null, 2)}</pre>
                : <Text>No effective source configuration is available.</Text>}
      </details>
    </Stack>
  );
}
