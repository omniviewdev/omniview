import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Link, useInformerState } from '@omniviewdev/runtime';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import { Avatar } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { NavMenu } from '@omniviewdev/ui/sidebars';

// Hooks
import {
  useConnection,
  useResourceTypes,
  useResourceGroups,
  useSnackbar,
  usePluginRouter,
} from '@omniviewdev/runtime';

// Layout
import Layout from '../layouts/resource';

import { stringAvatar } from '../utils/color';
import { useClusterPreferences } from '../hooks/useClusterPreferences';

// Icons
import { LuCog } from 'react-icons/lu';
import { useSidebarLayout } from '../hooks/useSidebarLayout';
import { useStoredState } from '../components/shared/hooks/useStoredState';
import ResourceCommandPalette from '../components/shared/ResourceCommandPalette';
import SyncProgressDialog from '../components/shared/SyncProgressDialog';


export default function ClusterResourcesPage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();

  const { types } = useResourceTypes({ pluginID: 'kubernetes', connectionID: id });
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID: id });
  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID: id });
  const { connectionOverrides } = useClusterPreferences('kubernetes');
  const { layout } = useSidebarLayout({ connectionID: id })
  const { location, navigate } = usePluginRouter();
  const [savedExpandedState, setSavedExpandedState] = useStoredState<Record<string, boolean>>(
    `kubernetes-${id}-sidebar-expanded`,
    {},
  );

  const handleExpandedChange = React.useCallback((state: Record<string, boolean>) => {
    setSavedExpandedState(state);
  }, [setSavedExpandedState]);
  const { isFullySynced, summary } = useInformerState({ pluginID: 'kubernetes', connectionID: id });

  const { showSnackbar } = useSnackbar();

  // Sync modal — open only when we know the connection is actively syncing,
  // not before data has loaded. `undefined` = "haven't decided yet".
  const [syncModalOpen, setSyncModalOpen] = React.useState<boolean | undefined>(undefined);

  // Track whether the modal was opened manually (e.g. footer Details click)
  // so we don't auto-close it.
  const manualOpenRef = React.useRef(false);

  // Once summary data loads, decide whether to show the modal
  React.useEffect(() => {
    if (syncModalOpen !== undefined) return; // already decided
    if (!summary.data) return; // data not loaded yet — don't decide
    if (!isFullySynced) {
      setSyncModalOpen(true);
    } else {
      setSyncModalOpen(false);
    }
  }, [summary.data, isFullySynced, syncModalOpen]);

  // Auto-close after sync completes — only when auto-opened (not user-initiated)
  React.useEffect(() => {
    if (isFullySynced && syncModalOpen === true && !manualOpenRef.current) {
      const timer = setTimeout(() => setSyncModalOpen(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isFullySynced, syncModalOpen]);

  const handleCloseSyncModal = React.useCallback(() => {
    manualOpenRef.current = false;
    setSyncModalOpen(false);
  }, []);

  // Listen for footer click to re-open sync modal
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.connectionID === id) {
        manualOpenRef.current = true;
        setSyncModalOpen(true);
      }
    };
    window.addEventListener('ov:show-sync-modal', handler);
    return () => window.removeEventListener('ov:show-sync-modal', handler);
  }, [id]);

  // Derive selected sidebar item from current route.
  // Dashboard routes end with 'resources', 'metrics', or 'benchmarks'.
  const DASHBOARD_TABS = new Set(['resources', 'metrics', 'benchmarks']);
  const lastSegment = location.pathname.split('/').pop() ?? '';
  const selected = DASHBOARD_TABS.has(lastSegment) ? '__dashboard__' : lastSegment;

  const handleSelect = React.useCallback((resourceID: string) => {
    if (resourceID === '__dashboard__') {
      navigate(`/cluster/${id}/resources`);
    } else {
      navigate(`/cluster/${id}/resources/${resourceID}`);
    }
  }, [navigate, id]);

  React.useEffect(() => {
    showSnackbar({
      message: 'You are currently running in development mode',
      details: 'Rendering performance will be slightly degraded until this application is built for production.',
      status: 'info',
      showOnce: true,
      autoHideDuration: 15000,
    });
  }, [showSnackbar]);

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (
      <SyncProgressDialog
        open={syncModalOpen === true}
        onClose={handleCloseSyncModal}
        clusterName={id}
        pluginID="kubernetes"
        connectionID={id}
      />
    );
  }

  if (groups.isError) {
    return (<>{types.error}</>);
  }

  const clusterName = connectionOverrides[id]?.displayName || connection.data?.name || id;

  return (
    <Layout.Root
      sx={{
        p: 0,
        gap: 0,
      }}
    >
      <ResourceCommandPalette connectionID={id} layout={layout} onNavigate={handleSelect} />
      <Layout.SideNav type='bordered' padding={0.5} >
        <Stack
          direction='column'
          sx={{
            maxHeight: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
          gap={0.5}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack direction='row' alignItems='center' gap={1}>
              {(() => {
                const override = connectionOverrides[id];
                const avatarSrc = override?.avatar || connection.data?.avatar;
                if (avatarSrc) {
                  return (
                    <Avatar
                      size='sm'
                      src={avatarSrc}
                      sx={{
                        backgroundColor: 'transparent',
                        objectFit: 'contain',
                        border: 0,
                        maxHeight: 28,
                        maxWidth: 28,
                      }}
                    />
                  );
                }
                const avatarProps = stringAvatar(override?.displayName || connection.data?.name || '');
                if (override?.avatarColor) {
                  avatarProps.sx = { ...avatarProps.sx, bgcolor: override.avatarColor };
                }
                return <Avatar size='sm' {...avatarProps} />;
              })()}
              <Text weight='semibold' size='sm' sx={{ textOverflow: 'ellipsis' }}>
                {connectionOverrides[id]?.displayName || connection.data?.name}
              </Text>
            </Stack>
            <Stack direction='row' alignItems='center' gap={1}>
              <Link to={`/cluster/${id}/edit`}>
                <IconButton emphasis='soft' size='sm' color='neutral'>
                  <LuCog size={20} />
                </IconButton>
              </Link>
            </Stack>
          </Box>
          <NavMenu
            size='sm'
            sections={layout}
            selected={selected}
            onSelect={handleSelect}
            scrollable
            animate={false}
            initialExpandedState={savedExpandedState}
            onExpandedChange={handleExpandedChange}
          />
        </Stack>
      </Layout.SideNav>
      <Layout.Main
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Outlet />
        </Box>
      </Layout.Main>
      <SyncProgressDialog
        open={syncModalOpen === true}
        onClose={handleCloseSyncModal}
        clusterName={clusterName}
        pluginID="kubernetes"
        connectionID={id}
      />
    </Layout.Root>
  );
}
