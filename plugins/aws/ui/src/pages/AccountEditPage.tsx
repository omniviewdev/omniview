import React from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, IconButton, Separator, Stack, Text } from '@omniviewdev/base-ui';
import TextInput from '../components/shared/ui/TextInput';
import TextAreaInput from '../components/shared/ui/TextAreaInput';
import { LuArrowLeft, LuSave } from 'react-icons/lu';
import {
  usePluginContext,
  useConnection,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { useAccountPreferences } from '../hooks/useAccountPreferences';
import type { ConnectionOverride } from '../types/accounts';
import NamedAvatar from '../components/shared/NamedAvatar';

const cardStyle: React.CSSProperties = { minWidth: 0, flexShrink: 0 };
const labelStyle: React.CSSProperties = { marginBottom: 4 };

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
    <Stack direction='column' spacing={4} style={{ padding: 16, width: '100%', height: '100%', overflow: 'auto' }}>
      <Stack direction='row' align='center' spacing={2}>
        <IconButton size='sm' variant='ghost' aria-label='Back' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Text weight="semibold" size="lg">Edit Account</Text>
        <Text size="sm" style={{ opacity: 0.6 }}>{connectionId}</Text>
        <div style={{ flex: 1 }} />
        <Button size='sm' variant='solid' color='brand' startDecorator={<LuSave size={16} />} onClick={handleSave}>
          Save
        </Button>
        <Button size='sm' variant='ghost' color='neutral' onClick={handleBack}>Cancel</Button>
      </Stack>

      <Separator />

      <Card variant='outline' style={cardStyle}>
        <div style={{ padding: 16 }}>
          <Text weight="semibold" as="div" style={{ marginBottom: 16 }}>Identity</Text>
          <Stack spacing={4}>
            <Stack direction='row' spacing={4} align='start'>
              <div>
                {avatarUrl ? (
                  <img src={avatarUrl} alt='avatar' style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <NamedAvatar value={conn?.name ?? connectionId} />
                )}
              </div>
              <Stack spacing={4} style={{ flex: 1 }}>
                <div>
                  <Text size="sm" as="div" style={labelStyle}>Display Name</Text>
                  <TextInput size='sm' placeholder={conn?.name ?? 'Enter display name'} value={displayName} onChange={value => setDisplayName(value)} />
                </div>
                <div>
                  <Text size="sm" as="div" style={labelStyle}>Avatar URL</Text>
                  <TextInput size='sm' placeholder='https://...' value={avatarUrl} onChange={value => setAvatarUrl(value)} />
                </div>
              </Stack>
            </Stack>
            <div>
              <Text size="sm" as="div" style={labelStyle}>Description</Text>
              <TextAreaInput size='sm' minRows={2} maxRows={4} placeholder='Optional description' value={description} onChange={value => setDescription(value)} />
            </div>
          </Stack>
        </div>
      </Card>

      {conn && (
        <Card variant='outline' style={cardStyle}>
          <div style={{ padding: 16 }}>
            <Text weight="semibold" as="div" style={{ marginBottom: 16 }}>Connection Details</Text>
            <div style={{ borderRadius: 4, padding: 16, backgroundColor: 'var(--ov-color-bg-surface)' }}>
              <Stack spacing={3}>
                <DetailRow label='Connection ID' value={conn.id} />
                {conn.labels?.profile && <DetailRow label='Profile' value={String(conn.labels.profile)} />}
                {conn.labels?.region && <DetailRow label='Region' value={String(conn.labels.region)} />}
                {conn.labels?.account_id && <DetailRow label='Account ID' value={String(conn.labels.account_id)} />}
              </Stack>
            </div>
          </div>
        </Card>
      )}
    </Stack>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction='row' spacing={4}>
      <Text size="sm" style={{ fontWeight: 600, minWidth: 120 }}>{label}</Text>
      <Text size="sm" style={{ wordBreak: 'break-all' }}>{value}</Text>
    </Stack>
  );
}

export default AccountEditPage;
