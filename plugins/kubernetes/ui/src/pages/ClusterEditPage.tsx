import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormLabel,
  Grid,
  IconButton,
  Input,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Textarea,
  Typography,
} from '@mui/joy';
import {
  LuArrowLeft,
  LuCircle,
  LuCpu,
  LuFileText,
  LuGlobe,
  LuKey,
  LuLayers,
  LuBox,
  LuRefreshCw,
  LuSave,
  LuServer,
  LuTag,
  LuUser,
} from 'react-icons/lu';
import {
  usePluginContext,
  useConnection,
  usePluginRouter,
} from '@omniviewdev/runtime';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import type { ConnectionOverride } from '../types/clusters';
import AvatarEditor from '../components/connections/AvatarEditor';
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
  const [avatarColor, setAvatarColor] = React.useState(existing.avatarColor ?? '');
  const [tags, setTags] = React.useState<string[]>(existing.tags ?? []);

  // Sync form state when overrides load
  React.useEffect(() => {
    const o = connectionOverrides[connectionId];
    if (o) {
      setDisplayName(prev => prev || o.displayName || '');
      setDescription(prev => prev || o.description || '');
      setAvatarUrl(prev => prev || o.avatar || '');
      setAvatarColor(prev => prev || o.avatarColor || '');
      setTags(prev => prev.length === 0 ? (o.tags ?? []) : prev);
    }
  }, [connectionOverrides, connectionId]);

  const handleSave = async () => {
    const override: ConnectionOverride = {};
    if (displayName) override.displayName = displayName;
    if (description) override.description = description;
    if (avatarUrl) override.avatar = avatarUrl;
    if (avatarColor) override.avatarColor = avatarColor;
    if (tags.length > 0) override.tags = tags;
    await updateOverride(connectionId, override);
    navigate('/');
  };

  const handleBack = () => navigate('/');

  const connected = React.useMemo(() => {
    if (!conn) return false;
    const refreshTime = new Date(conn.last_refresh);
    if (refreshTime.toString() === 'Invalid Date') return false;
    return (refreshTime.getTime() + conn.expiry_time) > Date.now();
  }, [conn]);

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
      sx={{ width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {/* Header */}
      <Stack direction='row' alignItems='center' gap={1} sx={{ px: 2, pt: 2, pb: 1 }}>
        <IconButton size='sm' variant='plain' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Typography level='h4'>Edit Cluster</Typography>
        <Typography level='body-sm' sx={{ opacity: 0.6 }}>
          {connectionId}
        </Typography>
        <Chip
          size='sm'
          variant='soft'
          color={connected ? 'success' : 'neutral'}
          startDecorator={<LuCircle size={8} fill='currentColor' />}
        >
          {connected ? 'Connected' : 'Disconnected'}
        </Chip>
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

      {/* Tabs */}
      <Tabs
        defaultValue='general'
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          '& > [hidden]': { display: 'none !important', flex: 'none' },
        }}
      >
        <TabList
          size='sm'
          sx={{
            px: 1,
            pt: 0.5,
            gap: 0.5,
            '--ListItem-radius': '6px',
          }}
        >
          <Tab value='general' variant='soft'>General</Tab>
        </TabList>

        <TabPanel
          value='general'
          sx={{ p: 2, flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          <Stack direction='column' gap={2}>
            {/* Identity section */}
            <Card variant='outlined'>
              <CardContent>
                <Typography level='title-md' sx={{ mb: 2 }}>Identity</Typography>
                <Stack direction='row' gap={3} alignItems='flex-start'>
                  <AvatarEditor
                    name={displayName || conn?.name || connectionId}
                    avatarUrl={avatarUrl}
                    avatarColor={avatarColor}
                    onAvatarUrlChange={setAvatarUrl}
                    onAvatarColorChange={setAvatarColor}
                  />
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

            {/* Cluster info + Connection side-by-side */}
            {conn && (
              <Grid container spacing={2}>
                {/* Cluster info (discovered on connect) */}
                <Grid xs={12} md={6}>
                  <Card variant='outlined' sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography level='title-md' sx={{ mb: 1.5 }}>Cluster Info</Typography>
                      <Grid container spacing={1}>
                        <Grid xs={12}>
                          <InfoCell icon={<LuGlobe size={14} />} label='Server' value={String(conn.data?.server_url ?? conn.labels?.server ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuTag size={14} />} label='K8s Version' value={String(conn.data?.k8s_version ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuCpu size={14} />} label='Platform' value={String(conn.data?.k8s_platform ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuServer size={14} />} label='Nodes' value={conn.data?.node_count != null ? String(conn.data.node_count) : '-'} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuLayers size={14} />} label='API Groups' value={conn.data?.api_groups != null ? String(conn.data.api_groups) : '-'} />
                        </Grid>
                        <Grid xs={12}>
                          <InfoCell icon={<LuRefreshCw size={14} />} label='Last Checked' value={conn.data?.last_checked ? formatTime(conn.data.last_checked) : '-'} />
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Connection config (from kubeconfig) */}
                <Grid xs={12} md={6}>
                  <Card variant='outlined' sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography level='title-md' sx={{ mb: 1.5 }}>Connection</Typography>
                      <Grid container spacing={1}>
                        <Grid xs={6}>
                          <InfoCell icon={<LuBox size={14} />} label='Context' value={conn.id} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuServer size={14} />} label='Cluster' value={String(conn.labels?.cluster ?? conn.data?.cluster ?? '-')} />
                        </Grid>
                        <Grid xs={12}>
                          <InfoCell icon={<LuFileText size={14} />} label='Kubeconfig' value={String(conn.labels?.kubeconfig ?? conn.data?.kubeconfig ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuUser size={14} />} label='User' value={String(conn.labels?.user ?? conn.data?.user ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuKey size={14} />} label='Auth Method' value={String(conn.labels?.auth_method ?? '-')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuLayers size={14} />} label='Namespace' value={String(conn.data?.namespace ?? '(default)')} />
                        </Grid>
                        <Grid xs={6}>
                          <InfoCell icon={<LuRefreshCw size={14} />} label='Last Refresh' value={formatTime(conn.last_refresh)} />
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            )}
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

function InfoCell({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const empty = value === '-';
  return (
    <Box sx={{
      borderRadius: 'sm',
      bgcolor: 'background.level1',
      px: 1.5,
      py: 1,
    }}>
      <Stack direction='row' gap={0.75} alignItems='center' sx={{ mb: 0.25 }}>
        <Box sx={{ color: 'text.tertiary', display: 'flex' }}>{icon}</Box>
        <Typography level='body-xs' sx={{ color: 'text.tertiary' }}>{label}</Typography>
      </Stack>
      <Typography
        level='body-sm'
        fontWeight={500}
        sx={{
          wordBreak: 'break-all',
          opacity: empty ? 0.4 : 1,
          fontStyle: empty ? 'italic' : undefined,
        }}
      >
        {empty ? 'Not discovered' : value}
      </Typography>
    </Box>
  );
}

export default ClusterEditPage;
