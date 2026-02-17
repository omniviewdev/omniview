import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Sheet,
  Stack,
  Textarea,
  Typography,
} from '@mui/joy';
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
        <IconButton size='sm' variant='plain' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Typography level='h4'>Edit Account</Typography>
        <Typography level='body-sm' sx={{ opacity: 0.6 }}>{connectionId}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size='sm' variant='solid' color='primary' startDecorator={<LuSave size={16} />} onClick={handleSave}>
          Save
        </Button>
        <Button size='sm' variant='plain' color='neutral' onClick={handleBack}>Cancel</Button>
      </Stack>

      <Divider />

      <Card variant='outlined'>
        <CardContent>
          <Typography level='title-md' sx={{ mb: 2 }}>Identity</Typography>
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
                <FormControl>
                  <FormLabel>Display Name</FormLabel>
                  <Input size='sm' placeholder={conn?.name ?? 'Enter display name'} value={displayName} onChange={e => setDisplayName(e.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Avatar URL</FormLabel>
                  <Input size='sm' placeholder='https://...' value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} />
                </FormControl>
              </Stack>
            </Stack>
            <FormControl>
              <FormLabel>Description</FormLabel>
              <Textarea size='sm' minRows={2} maxRows={4} placeholder='Optional description' value={description} onChange={e => setDescription(e.target.value)} />
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      {conn && (
        <Card variant='outlined'>
          <CardContent>
            <Typography level='title-md' sx={{ mb: 2 }}>Connection Details</Typography>
            <Sheet variant='soft' sx={{ borderRadius: 'sm', p: 2 }}>
              <Stack gap={1.5}>
                <DetailRow label='Connection ID' value={conn.id} />
                {conn.labels?.profile && <DetailRow label='Profile' value={String(conn.labels.profile)} />}
                {conn.labels?.region && <DetailRow label='Region' value={String(conn.labels.region)} />}
                {conn.labels?.account_id && <DetailRow label='Account ID' value={String(conn.labels.account_id)} />}
              </Stack>
            </Sheet>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction='row' gap={2}>
      <Typography level='body-sm' fontWeight={600} sx={{ minWidth: 120 }}>{label}</Typography>
      <Typography level='body-sm' sx={{ wordBreak: 'break-all' }}>{value}</Typography>
    </Stack>
  );
}

export default AccountEditPage;
