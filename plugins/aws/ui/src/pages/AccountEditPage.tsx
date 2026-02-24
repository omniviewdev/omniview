import React from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, TextArea } from '@omniviewdev/ui/inputs';
import { Card } from '@omniviewdev/ui';
import { LuArrowLeft, LuSave } from 'react-icons/lu';
import {
  usePluginContext,
  useConnection,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { useAccountPreferences } from '../hooks/useAccountPreferences';
import type { ConnectionOverride } from '../types/accounts';
import NamedAvatar from '../components/shared/NamedAvatar';

const AccountEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';

  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { connection } = useConnection({ pluginID: meta.id, connectionID: connectionId });
  const { connectionOverrides, updateOverride } = useAccountPreferences(meta.id);

  const existing = connectionOverrides[connectionId] ?? {};
  const conn = connection.data;

  const [displayName, setDisplayName] = React.useState(existing.displayName ?? '');
  const [description, setDescription] = React.useState(existing.description ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(existing.avatar ?? '');

  React.useEffect(() => {
    const o = connectionOverrides[connectionId];
    if (o) {
      setDisplayName(prev => prev || o.displayName || '');
      setDescription(prev => prev || o.description || '');
      setAvatarUrl(prev => prev || o.avatar || '');
    }
  }, [connectionOverrides, connectionId]);

  const handleSave = async () => {
    const override: ConnectionOverride = {};
    if (displayName) override.displayName = displayName;
    if (description) override.description = description;
    if (avatarUrl) override.avatar = avatarUrl;
    await updateOverride(connectionId, override);
    navigate('/');
  };

  const handleBack = () => navigate('/');

  return (
    <Stack direction='column' gap={2} p={2} sx={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <Stack direction='row' alignItems='center' gap={1}>
        <IconButton size='sm' emphasis='ghost' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Text weight="semibold" size="lg">Edit Account</Text>
        <Text size="sm" sx={{ opacity: 0.6 }}>{connectionId}</Text>
        <Box sx={{ flex: 1 }} />
        <Button size='sm' emphasis='solid' color='primary' startAdornment={<LuSave size={16} />} onClick={handleSave}>
          Save
        </Button>
        <Button size='sm' emphasis='ghost' color='neutral' onClick={handleBack}>Cancel</Button>
      </Stack>

      <Divider />

      <Card variant='outlined'>
        <Box sx={{ p: 2 }}>
          <Text weight="semibold" sx={{ mb: 2 }}>Identity</Text>
          <Stack gap={2}>
            <Stack direction='row' gap={2} alignItems='flex-start'>
              <Box>
                {avatarUrl ? (
                  <img src={avatarUrl} alt='avatar' style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <NamedAvatar value={conn?.name ?? connectionId} />
                )}
              </Box>
              <Stack gap={2} sx={{ flex: 1 }}>
                <Box>
                  <Text size="sm" sx={{ mb: 0.5 }}>Display Name</Text>
                  <TextField size='sm' placeholder={conn?.name ?? 'Enter display name'} value={displayName} onChange={value => setDisplayName(value)} />
                </Box>
                <Box>
                  <Text size="sm" sx={{ mb: 0.5 }}>Avatar URL</Text>
                  <TextField size='sm' placeholder='https://...' value={avatarUrl} onChange={value => setAvatarUrl(value)} />
                </Box>
              </Stack>
            </Stack>
            <Box>
              <Text size="sm" sx={{ mb: 0.5 }}>Description</Text>
              <TextArea size='sm' minRows={2} maxRows={4} placeholder='Optional description' value={description} onChange={value => setDescription(value)} />
            </Box>
          </Stack>
        </Box>
      </Card>

      {conn && (
        <Card variant='outlined'>
          <Box sx={{ p: 2 }}>
            <Text weight="semibold" sx={{ mb: 2 }}>Connection Details</Text>
            <Box sx={{ borderRadius: 1, p: 2, bgcolor: 'background.paper' }}>
              <Stack gap={1.5}>
                <DetailRow label='Connection ID' value={conn.id} />
                {conn.labels?.profile && <DetailRow label='Profile' value={String(conn.labels.profile)} />}
                {conn.labels?.region && <DetailRow label='Region' value={String(conn.labels.region)} />}
                {conn.labels?.account_id && <DetailRow label='Account ID' value={String(conn.labels.account_id)} />}
              </Stack>
            </Box>
          </Box>
        </Card>
      )}
    </Stack>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction='row' gap={2}>
      <Text size="sm" sx={{ fontWeight: 600, minWidth: 120 }}>{label}</Text>
      <Text size="sm" sx={{ wordBreak: 'break-all' }}>{value}</Text>
    </Stack>
  );
}

export default AccountEditPage;
