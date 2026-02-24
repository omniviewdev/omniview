import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Card, Chip } from '@omniviewdev/ui';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { FormField, TextField, TextArea } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';
import { Text, Heading } from '@omniviewdev/ui/typography';
import {
  LuActivity,
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
  LuTerminal,
  LuUser,
} from 'react-icons/lu';
import {
  usePluginContext,
  useConnection,
} from '@omniviewdev/runtime';
import { useClusterPreferences } from '../hooks/useClusterPreferences';
import type { ConnectionOverride } from '../types/clusters';
import AvatarEditor from '../components/connections/AvatarEditor';
import TagInput from '../components/connections/TagInput';
import MetricsTabContent from '../components/settings/MetricsTabContent';
import NodeShellTabContent from '../components/settings/NodeShellTabContent';

const ClusterEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';

  const { meta } = usePluginContext();
  const rrNavigate = useNavigate();
  const { connection } = useConnection({ pluginID: meta.id, connectionID: connectionId });
  const { connectionOverrides, availableTags, updateOverride } = useClusterPreferences(meta.id);

  const existing = connectionOverrides[connectionId] ?? {};
  const conn = connection.data;

  const [displayName, setDisplayName] = React.useState(existing.displayName ?? '');
  const [description, setDescription] = React.useState(existing.description ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(existing.avatar ?? '');
  const [avatarColor, setAvatarColor] = React.useState(existing.avatarColor ?? '');
  const [tags, setTags] = React.useState<string[]>(existing.tags ?? []);
  const [activeTab, setActiveTab] = React.useState('general');

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
    // Spread existing overrides so we preserve fields managed by other tabs
    // (e.g. metricConfig from the Metrics tab).
    const override: ConnectionOverride = { ...existing };
    override.displayName = displayName || undefined;
    override.description = description || undefined;
    override.avatar = avatarUrl || undefined;
    override.avatarColor = avatarColor || undefined;
    override.tags = tags.length > 0 ? tags : undefined;
    await updateOverride(connectionId, override);
    rrNavigate(-1);
  };

  const handleBack = () => rrNavigate(-1);

  const connected = React.useMemo(() => {
    if (!conn) return false;
    const refreshTime = new Date(conn.last_refresh as unknown as string);
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
        <IconButton size='sm' emphasis='ghost' onClick={handleBack}>
          <LuArrowLeft size={20} />
        </IconButton>
        <Heading level={4}>Edit Cluster</Heading>
        <Text size='sm' sx={{ opacity: 0.6 }}>
          {connectionId}
        </Text>
        <Chip
          size='sm'
          emphasis='soft'
          color={connected ? 'success' : 'neutral'}
          startAdornment={<LuCircle size={8} fill='currentColor' />}
          label={connected ? 'Connected' : 'Disconnected'}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size='sm'
          emphasis='solid'
          color='primary'
          startAdornment={<LuSave size={16} />}
          onClick={handleSave}
        >
          Save
        </Button>
        <Button size='sm' emphasis='ghost' color='neutral' onClick={handleBack}>
          Cancel
        </Button>
      </Stack>

      {/* Tabs */}
      <Tabs
        tabs={[
          { key: 'general', label: 'General' },
          { key: 'metrics', label: 'Metrics', icon: <LuActivity size={14} /> },
          { key: 'shell', label: 'Node Shell', icon: <LuTerminal size={14} /> },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />
      <TabPanel
        value='general'
        activeValue={activeTab}
      >
          <Stack direction='column' gap={2}>
            {/* Identity section */}
            <Card variant='outlined'>
              <Box sx={{ p: 2 }}>
                <Text weight='semibold' sx={{ mb: 2 }}>Identity</Text>
                <Stack direction='row' gap={3} alignItems='flex-start'>
                  <AvatarEditor
                    name={displayName || conn?.name || connectionId}
                    avatarUrl={avatarUrl}
                    avatarColor={avatarColor}
                    onAvatarUrlChange={setAvatarUrl}
                    onAvatarColorChange={setAvatarColor}
                  />
                  <Stack gap={2} sx={{ flex: 1 }}>
                    <FormField label='Display Name'>
                      <TextField
                        size='sm'
                        placeholder={conn?.name ?? 'Enter display name'}
                        value={displayName}
                        onChange={e => setDisplayName(e)}
                      />
                    </FormField>
                    <FormField label='Description'>
                      <TextArea
                        size='sm'
                        minRows={2}
                        maxRows={4}
                        placeholder='Optional description for this cluster'
                        value={description}
                        onChange={e => setDescription(e)}
                      />
                    </FormField>
                  </Stack>
                </Stack>
              </Box>
            </Card>

            {/* Tags section */}
            <Card variant='outlined'>
              <Box sx={{ p: 2 }}>
                <Text weight='semibold' sx={{ mb: 1 }}>Tags</Text>
                <Text size='sm' sx={{ mb: 1.5, opacity: 0.7 }}>
                  Organize clusters by environment, team, or any custom category.
                </Text>
                <TagInput
                  tags={tags}
                  availableTags={availableTags}
                  onChange={setTags}
                />
              </Box>
            </Card>

            {/* Cluster info + Connection side-by-side */}
            {conn && (
              <Grid container spacing={2}>
                {/* Cluster info (discovered on connect) */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant='outlined' sx={{ height: '100%' }}>
                    <Box sx={{ p: 2 }}>
                      <Text weight='semibold' sx={{ mb: 1.5 }}>Cluster Info</Text>
                      <Grid container spacing={1}>
                        <Grid size={12}>
                          <InfoCell icon={<LuGlobe size={14} />} label='Server' value={String(conn.data?.server_url ?? conn.labels?.server ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuTag size={14} />} label='K8s Version' value={String(conn.data?.k8s_version ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuCpu size={14} />} label='Platform' value={String(conn.data?.k8s_platform ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuServer size={14} />} label='Nodes' value={conn.data?.node_count != null ? String(conn.data.node_count) : '-'} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuLayers size={14} />} label='API Groups' value={conn.data?.api_groups != null ? String(conn.data.api_groups) : '-'} />
                        </Grid>
                        <Grid size={12}>
                          <InfoCell icon={<LuRefreshCw size={14} />} label='Last Checked' value={conn.data?.last_checked ? formatTime(conn.data.last_checked) : '-'} />
                        </Grid>
                      </Grid>
                    </Box>
                  </Card>
                </Grid>

                {/* Connection config (from kubeconfig) */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant='outlined' sx={{ height: '100%' }}>
                    <Box sx={{ p: 2 }}>
                      <Text weight='semibold' sx={{ mb: 1.5 }}>Connection</Text>
                      <Grid container spacing={1}>
                        <Grid size={6}>
                          <InfoCell icon={<LuBox size={14} />} label='Context' value={conn.id} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuServer size={14} />} label='Cluster' value={String(conn.labels?.cluster ?? conn.data?.cluster ?? '-')} />
                        </Grid>
                        <Grid size={12}>
                          <InfoCell icon={<LuFileText size={14} />} label='Kubeconfig' value={String(conn.labels?.kubeconfig ?? conn.data?.kubeconfig ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuUser size={14} />} label='User' value={String(conn.labels?.user ?? conn.data?.user ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuKey size={14} />} label='Auth Method' value={String(conn.labels?.auth_method ?? '-')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuLayers size={14} />} label='Namespace' value={String(conn.data?.namespace ?? '(default)')} />
                        </Grid>
                        <Grid size={6}>
                          <InfoCell icon={<LuRefreshCw size={14} />} label='Last Refresh' value={formatTime(conn.last_refresh)} />
                        </Grid>
                      </Grid>
                    </Box>
                  </Card>
                </Grid>
              </Grid>
            )}
          </Stack>
      </TabPanel>
      <TabPanel value='metrics' activeValue={activeTab}>
        <MetricsTabContent
          pluginID={meta.id}
          connectionID={connectionId}
          connected={connected}
        />
      </TabPanel>
      <TabPanel value='shell' activeValue={activeTab}>
        <NodeShellTabContent
          pluginID={meta.id}
          connectionID={connectionId}
        />
      </TabPanel>
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
      borderRadius: 1,
      bgcolor: 'background.level1',
      px: 1.5,
      py: 1,
    }}>
      <Stack direction='row' gap={0.75} alignItems='center' sx={{ mb: 0.25 }}>
        <Box sx={{ color: 'text.tertiary', display: 'flex' }}>{icon}</Box>
        <Text size='xs' sx={{ color: 'text.tertiary' }}>{label}</Text>
      </Stack>
      <Text
        size='sm'
        sx={{
          fontWeight: 500,
          wordBreak: 'break-all',
          opacity: empty ? 0.4 : 1,
          fontStyle: empty ? 'italic' : undefined,
        }}
      >
        {empty ? 'Not discovered' : value}
      </Text>
    </Box>
  );
}

export default ClusterEditPage;
