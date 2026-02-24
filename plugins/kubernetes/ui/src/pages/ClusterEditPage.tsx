import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import MuiAvatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import { Avatar, Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { FormField, TextField, TextArea } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { NavMenu, type NavSection } from '@omniviewdev/ui/sidebars';
import {
  LuArrowLeft,
  LuCircle,
  LuSave,
  LuX,
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
import Layout from '../layouts/resource';
import { stringToColor } from '../utils/color';
import { getInitials } from '../utils/avatarUtils';

type SectionId = 'identity' | 'tags' | 'cluster-info' | 'connection' | 'metrics' | 'node-shell';

const SECTIONS: NavSection[] = [
  {
    title: 'General',
    items: [
      { id: 'identity', label: 'Identity' },
      { id: 'tags', label: 'Tags' },
      { id: 'cluster-info', label: 'Cluster Info' },
      { id: 'connection', label: 'Connection' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { id: 'metrics', label: 'Metrics' },
      { id: 'node-shell', label: 'Node Shell' },
    ],
  },
];

const ClusterEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const connectionId = id ? decodeURIComponent(id) : '';

  const { meta } = usePluginContext();
  const rrNavigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get('section') ?? 'identity') as SectionId;

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

  const hasDrafts = React.useMemo(() => {
    const o = connectionOverrides[connectionId] ?? {};
    return (
      displayName !== (o.displayName ?? '') ||
      description !== (o.description ?? '') ||
      avatarUrl !== (o.avatar ?? '') ||
      avatarColor !== (o.avatarColor ?? '') ||
      JSON.stringify(tags) !== JSON.stringify(o.tags ?? [])
    );
  }, [connectionOverrides, connectionId, displayName, description, avatarUrl, avatarColor, tags]);

  const handleSave = async () => {
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

  const handleCancel = () => {
    const o = connectionOverrides[connectionId] ?? {};
    setDisplayName(o.displayName ?? '');
    setDescription(o.description ?? '');
    setAvatarUrl(o.avatar ?? '');
    setAvatarColor(o.avatarColor ?? '');
    setTags(o.tags ?? []);
  };

  // Esc key handler
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const handleSectionChange = (id: string) => {
    setSearchParams({ section: id }, { replace: true });
  };

  // Cluster card display values
  const cardName = displayName || conn?.name || connectionId;
  const cardBgColor = avatarColor || stringToColor(cardName);
  const cardInitials = getInitials(cardName);

  return (
    <Layout.Root>
      <Layout.SideNav type='bordered' scrollable>
        <Stack direction='column' sx={{ height: '100%' }}>
          {/* Header with back + title + actions */}
          <Stack direction='row' alignItems='center' gap={0.5} sx={{ px: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <IconButton size='sm' emphasis='ghost' onClick={handleBack}>
              <LuArrowLeft size={16} />
            </IconButton>
            <Text size='sm' weight='semibold' sx={{ flex: 1, ml: 0.25 }}>Cluster Settings</Text>
            {hasDrafts && (
              <>
                <Tooltip title='Discard changes' placement='bottom'>
                  <IconButton size='sm' emphasis='ghost' color='neutral' onClick={handleCancel}>
                    <LuX size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title='Save changes' placement='bottom'>
                  <IconButton size='sm' emphasis='ghost' color='primary' onClick={handleSave}>
                    <LuSave size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Stack>

          {/* Cluster card */}
          <Box sx={{ px: 1, py: 1 }}>
            <Box sx={{
              bgcolor: 'background.level1',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.25,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
            }}>
              {avatarUrl ? (
                <Avatar
                  src={avatarUrl}
                  sx={{ width: 40, height: 40, borderRadius: 1, '--Avatar-size': '40px' }}
                />
              ) : (
                <MuiAvatar
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    bgcolor: cardBgColor,
                    fontSize: '0.875rem',
                  }}
                >
                  {cardInitials}
                </MuiAvatar>
              )}
              <Stack direction='column' gap={0.25} sx={{ minWidth: 0, flex: 1 }}>
                <Text size='sm' weight='semibold' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cardName}
                </Text>
                <Stack direction='row' alignItems='center' gap={0.75}>
                  <Chip
                    size='sm'
                    emphasis='soft'
                    color={connected ? 'success' : 'neutral'}
                    startAdornment={<LuCircle size={6} fill='currentColor' />}
                    label={connected ? 'Connected' : 'Disconnected'}
                  />
                </Stack>
              </Stack>
            </Box>
          </Box>

          {/* Nav menu */}
          <NavMenu
            size='sm'
            sections={SECTIONS}
            selected={section}
            onSelect={handleSectionChange}
            sx={{ py: 0.5 }}
          />
        </Stack>
      </Layout.SideNav>

      <Layout.Main sx={{ p: 3, overflow: 'auto' }}>
        {section === 'identity' && (
          <IdentitySection
            displayName={displayName}
            description={description}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
            connName={conn?.name ?? connectionId}
            onDisplayNameChange={setDisplayName}
            onDescriptionChange={setDescription}
            onAvatarUrlChange={setAvatarUrl}
            onAvatarColorChange={setAvatarColor}
          />
        )}
        {section === 'tags' && (
          <TagsSection
            tags={tags}
            availableTags={availableTags}
            onChange={setTags}
          />
        )}
        {section === 'cluster-info' && conn && (
          <ClusterInfoSection conn={conn} formatTime={formatTime} />
        )}
        {section === 'connection' && conn && (
          <ConnectionSection conn={conn} formatTime={formatTime} />
        )}
        {section === 'metrics' && (
          <SectionWrapper title='Metrics' description='Configure Prometheus metrics collection for this cluster.'>
            <MetricsTabContent
              pluginID={meta.id}
              connectionID={connectionId}
              connected={connected}
            />
          </SectionWrapper>
        )}
        {section === 'node-shell' && (
          <SectionWrapper title='Node Shell' description='Configure the debug pod and shell command used for node access.'>
            <NodeShellTabContent
              pluginID={meta.id}
              connectionID={connectionId}
            />
          </SectionWrapper>
        )}
      </Layout.Main>
    </Layout.Root>
  );
};

// ---------------------------------------------------------------------------
// Section wrapper with header (matches CoreSettingsPage pattern)
// ---------------------------------------------------------------------------

function SectionWrapper({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction='column' gap={0} sx={{ width: '100%', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction='column' gap={0.25}>
          <Text weight='semibold' size='lg'>{title}</Text>
          <Text size='xs' sx={{ color: 'text.secondary' }}>{description}</Text>
        </Stack>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, pt: 2 }}>
        {children}
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Identity section
// ---------------------------------------------------------------------------

function IdentitySection({ displayName, description, avatarUrl, avatarColor, connName, onDisplayNameChange, onDescriptionChange, onAvatarUrlChange, onAvatarColorChange }: {
  displayName: string;
  description: string;
  avatarUrl: string;
  avatarColor: string;
  connName: string;
  onDisplayNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onAvatarUrlChange: (v: string) => void;
  onAvatarColorChange: (v: string) => void;
}) {
  return (
    <SectionWrapper title='Identity' description='Customize how this cluster appears in the sidebar and connection list.'>
      <Stack direction='column' gap={0}>
        {/* Avatar row */}
        <Box sx={{ py: 2.5, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 180, maxWidth: 180, display: 'flex', flexDirection: 'column' }}>
            <Text size='sm' weight='medium'>Avatar</Text>
            <Text size='xs' sx={{ color: 'text.secondary', mt: 0.25 }}>Upload an image or pick a color</Text>
          </Box>
          <AvatarEditor
            name={displayName || connName}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
            onAvatarUrlChange={onAvatarUrlChange}
            onAvatarColorChange={onAvatarColorChange}
          />
        </Box>
        <Divider />

        {/* Display name row */}
        <Box sx={{ py: 2.5, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 180, maxWidth: 180, display: 'flex', flexDirection: 'column' }}>
            <Text size='sm' weight='medium'>Display Name</Text>
            <Text size='xs' sx={{ color: 'text.secondary', mt: 0.25 }}>Override the default context name</Text>
          </Box>
          <Box sx={{ flex: 1, maxWidth: 480 }}>
            <FormField>
              <TextField
                size='sm'
                placeholder={connName}
                value={displayName}
                onChange={e => onDisplayNameChange(e)}
                fullWidth
              />
            </FormField>
          </Box>
        </Box>
        <Divider />

        {/* Description row */}
        <Box sx={{ py: 2.5, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 180, maxWidth: 180, display: 'flex', flexDirection: 'column' }}>
            <Text size='sm' weight='medium'>Description</Text>
            <Text size='xs' sx={{ color: 'text.secondary', mt: 0.25 }}>Optional note for this cluster</Text>
          </Box>
          <Box sx={{ flex: 1, maxWidth: 480 }}>
            <FormField>
              <TextArea
                size='sm'
                minRows={2}
                maxRows={4}
                placeholder='Optional description for this cluster'
                value={description}
                onChange={e => onDescriptionChange(e)}
                fullWidth
              />
            </FormField>
          </Box>
        </Box>
      </Stack>
    </SectionWrapper>
  );
}

// ---------------------------------------------------------------------------
// Tags section
// ---------------------------------------------------------------------------

function TagsSection({ tags, availableTags, onChange }: {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
}) {
  return (
    <SectionWrapper title='Tags' description='Organize clusters by environment, team, or any custom category.'>
      <Box sx={{ maxWidth: 600 }}>
        <TagInput
          tags={tags}
          availableTags={availableTags}
          onChange={onChange}
        />
      </Box>
    </SectionWrapper>
  );
}

// ---------------------------------------------------------------------------
// Cluster Info section
// ---------------------------------------------------------------------------

function ClusterInfoSection({ conn, formatTime }: { conn: any; formatTime: (t: any) => string }) {
  return (
    <SectionWrapper title='Cluster Info' description='Read-only information discovered from the cluster.'>
      <Stack direction='column' gap={0}>
        <InfoRow label='Server' value={String(conn.data?.server_url ?? conn.labels?.server ?? '-')} />
        <InfoRow label='Kubernetes Version' value={String(conn.data?.k8s_version ?? '-')} />
        <InfoRow label='Platform' value={String(conn.data?.k8s_platform ?? '-')} />
        <InfoRow label='Nodes' value={conn.data?.node_count != null ? String(conn.data.node_count) : '-'} />
        <InfoRow label='API Groups' value={conn.data?.api_groups != null ? String(conn.data.api_groups) : '-'} />
        <InfoRow label='Last Checked' value={conn.data?.last_checked ? formatTime(conn.data.last_checked) : '-'} />
      </Stack>
    </SectionWrapper>
  );
}

// ---------------------------------------------------------------------------
// Connection section
// ---------------------------------------------------------------------------

function ConnectionSection({ conn, formatTime }: { conn: any; formatTime: (t: any) => string }) {
  return (
    <SectionWrapper title='Connection' description='Kubeconfig context details for this cluster.'>
      <Stack direction='column' gap={0}>
        <InfoRow label='Context' value={conn.id} />
        <InfoRow label='Cluster' value={String(conn.labels?.cluster ?? conn.data?.cluster ?? '-')} />
        <InfoRow label='Kubeconfig' value={String(conn.labels?.kubeconfig ?? conn.data?.kubeconfig ?? '-')} />
        <InfoRow label='User' value={String(conn.labels?.user ?? conn.data?.user ?? '-')} />
        <InfoRow label='Auth Method' value={String(conn.labels?.auth_method ?? '-')} />
        <InfoRow label='Namespace' value={String(conn.data?.namespace ?? '(default)')} />
        <InfoRow label='Last Refresh' value={formatTime(conn.last_refresh)} />
      </Stack>
    </SectionWrapper>
  );
}

// ---------------------------------------------------------------------------
// Flat label/value row (replaces the old InfoCell)
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  const empty = value === '-';
  return (
    <>
      <Box sx={{ py: 1.5, display: 'flex', gap: 4, alignItems: 'baseline' }}>
        <Text size='xs' sx={{ color: 'text.secondary', minWidth: 140 }}>{label}</Text>
        <Text
          size='sm'
          weight='medium'
          sx={{
            wordBreak: 'break-all',
            opacity: empty ? 0.4 : 1,
            fontStyle: empty ? 'italic' : undefined,
          }}
        >
          {empty ? 'Not discovered' : value}
        </Text>
      </Box>
      <Divider />
    </>
  );
}

export default ClusterEditPage;
