import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { LuArrowLeft, LuPlus, LuX, LuSave } from 'react-icons/lu';
import {
  usePluginContext,
  useConnection,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import type { ConnectionOverride } from '../types/clusters';
import NamedAvatar from '../components/shared/NamedAvatar';
import TagInput from '../components/connections/TagInput';

const ClusterEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';

  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { connection } = useConnection({ pluginID: meta.id, connectionID: connectionId });
  const { connectionOverrides, availableTags, updateOverride } = useClusterPreferences(meta.id);

  const existing = connectionOverrides[connectionId] ?? {};
  const conn = connection.data;

  const [displayName, setDisplayName] = React.useState(existing.displayName ?? '');
  const [description, setDescription] = React.useState(existing.description ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(existing.avatar ?? '');
  const [tags, setTags] = React.useState<string[]>(existing.tags ?? []);
  const [customLabels, setCustomLabels] = React.useState<Record<string, string>>(existing.customLabels ?? {});
  const [newLabelKey, setNewLabelKey] = React.useState('');
  const [newLabelValue, setNewLabelValue] = React.useState('');

  // Sync form state when overrides load
  React.useEffect(() => {
    const o = connectionOverrides[connectionId];
    if (o) {
      setDisplayName(prev => prev || o.displayName || '');
      setDescription(prev => prev || o.description || '');
      setAvatarUrl(prev => prev || o.avatar || '');
      setTags(prev => prev.length === 0 ? (o.tags ?? []) : prev);
      setCustomLabels(prev => Object.keys(prev).length === 0 ? (o.customLabels ?? {}) : prev);
    }
  }, [connectionOverrides, connectionId]);

  const handleSave = async () => {
    const override: ConnectionOverride = {};
    if (displayName) override.displayName = displayName;
    if (description) override.description = description;
    if (avatarUrl) override.avatar = avatarUrl;
    if (tags.length > 0) override.tags = tags;
    if (Object.keys(customLabels).length > 0) override.customLabels = customLabels;
    await updateOverride(connectionId, override);
    navigate('/');
  };

  const handleAddLabel = () => {
    if (newLabelKey.trim()) {
      setCustomLabels(prev => ({ ...prev, [newLabelKey.trim()]: newLabelValue }));
      setNewLabelKey('');
      setNewLabelValue('');
    }
  };

  const handleRemoveLabel = (key: string) => {
    setCustomLabels(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleBack = () => navigate('/');

  const formatTime = (timestamp: any): string => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    if (date.toString() === 'Invalid Date') return 'Never';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <Stack
      direction='column'
      gap={2}
      p={2}
      sx={{ width: '100%', height: '100%', overflow: 'auto' }}
    >
      {/* Header */}
      <Stack direction='row' alignItems='center' gap={1}>
        <IconButton size='sm' variant='plain' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Typography level='h4'>Edit Cluster</Typography>
        <Typography level='body-sm' sx={{ opacity: 0.6 }}>
          {connectionId}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size='sm'
          variant='solid'
          color='primary'
          startDecorator={<LuSave size={16} />}
          onClick={handleSave}
        >
          Save
        </Button>
        <Button size='sm' variant='plain' color='neutral' onClick={handleBack}>
          Cancel
        </Button>
      </Stack>

      <Divider />

      {/* Identity section */}
      <Card variant='outlined'>
        <CardContent>
          <Typography level='title-md' sx={{ mb: 2 }}>Identity</Typography>
          <Stack gap={2}>
            <Stack direction='row' gap={2} alignItems='flex-start'>
              <Box>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt='avatar'
                    style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }}
                  />
                ) : (
                  <NamedAvatar value={conn?.name ?? connectionId} />
                )}
              </Box>
              <Stack gap={2} sx={{ flex: 1 }}>
                <FormControl>
                  <FormLabel>Display Name</FormLabel>
                  <Input
                    size='sm'
                    placeholder={conn?.name ?? 'Enter display name'}
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Avatar URL</FormLabel>
                  <Input
                    size='sm'
                    placeholder='https://...'
                    value={avatarUrl}
                    onChange={e => setAvatarUrl(e.target.value)}
                  />
                </FormControl>
              </Stack>
            </Stack>
            <FormControl>
              <FormLabel>Description</FormLabel>
              <Textarea
                size='sm'
                minRows={2}
                maxRows={4}
                placeholder='Optional description for this cluster'
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      {/* Tags section */}
      <Card variant='outlined'>
        <CardContent>
          <Typography level='title-md' sx={{ mb: 1 }}>Tags</Typography>
          <Typography level='body-sm' sx={{ mb: 1.5, opacity: 0.7 }}>
            Organize clusters by environment, team, or any custom category.
          </Typography>
          <TagInput
            tags={tags}
            availableTags={availableTags}
            onChange={setTags}
          />
        </CardContent>
      </Card>

      {/* Custom labels */}
      <Card variant='outlined'>
        <CardContent>
          <Typography level='title-md' sx={{ mb: 2 }}>Custom Labels</Typography>
          <Stack gap={1}>
            {Object.entries(customLabels).map(([key, value]) => (
              <Stack key={key} direction='row' gap={1} alignItems='center'>
                <Chip size='sm' variant='soft'>{key}</Chip>
                <Typography level='body-sm' sx={{ flex: 1 }}>{value}</Typography>
                <IconButton size='sm' variant='plain' color='danger' onClick={() => handleRemoveLabel(key)}>
                  <LuX size={14} />
                </IconButton>
              </Stack>
            ))}
            <Stack direction='row' gap={1} alignItems='center'>
              <Input
                size='sm'
                placeholder='Key'
                value={newLabelKey}
                onChange={e => setNewLabelKey(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Input
                size='sm'
                placeholder='Value'
                value={newLabelValue}
                onChange={e => setNewLabelValue(e.target.value)}
                sx={{ flex: 2 }}
              />
              <IconButton size='sm' variant='soft' color='primary' onClick={handleAddLabel} disabled={!newLabelKey.trim()}>
                <LuPlus size={16} />
              </IconButton>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Connection details (read-only) */}
      {conn && (
        <Card variant='outlined'>
          <CardContent>
            <Typography level='title-md' sx={{ mb: 2 }}>Connection Details</Typography>
            <Sheet variant='soft' sx={{ borderRadius: 'sm', p: 2 }}>
              <Stack gap={1.5}>
                <DetailRow label='Connection ID' value={conn.id} />
                <DetailRow label='Cluster' value={String(conn.labels?.cluster ?? conn.data?.cluster ?? '-')} />
                <DetailRow label='Kubeconfig' value={String(conn.labels?.kubeconfig ?? conn.data?.kubeconfig ?? '-')} />
                <DetailRow label='User' value={String(conn.labels?.user ?? conn.data?.user ?? '-')} />
                <DetailRow label='Namespace' value={String(conn.data?.namespace ?? '(default)')} />
                <DetailRow label='Last Refresh' value={formatTime(conn.last_refresh)} />
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

export default ClusterEditPage;
