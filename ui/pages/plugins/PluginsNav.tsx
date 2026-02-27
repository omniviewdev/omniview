import React from 'react';

import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import InputBase from '@mui/material/InputBase';
import { styled } from '@mui/material/styles';

import {
  LuChevronDown,
  LuChevronRight,
  LuSearch,
  LuRefreshCw,
  LuSlidersHorizontal,
  LuEllipsis,
  LuFolderOpen,
  LuAtom,
  LuTriangleAlert,
} from 'react-icons/lu';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar, createErrorHandler } from '@omniviewdev/runtime';
import { PluginManager } from '@omniviewdev/runtime/api';
import { EventsEmit } from '@omniviewdev/runtime/runtime';

import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { loadAndRegisterPlugin } from '@/features/plugins/api/loader';
import PluginListItem from './PluginListItem';
import PluginFilterPopover, {
  getActiveFilterCount,
  type FilterState,
  type SortOption,
} from './PluginFilterPopover';

// ─── Styled Components ─────────────────────────────────────────

const SearchInput = styled(InputBase)({
  fontSize: '0.8125rem',
  width: '100%',
  '& .MuiInputBase-input': {
    padding: '6px 8px 6px 0',
    '&::placeholder': {
      opacity: 0.5,
    },
  },
});

const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
});

const SectionLabel = styled('span')({
  fontSize: '0.6875rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--ov-fg-faint, #8b949e)',
});

const CountBadge = styled('span')({
  fontSize: '0.625rem',
  fontWeight: 600,
  backgroundColor: 'rgba(56,139,253,0.2)',
  color: 'rgba(56,139,253,0.9)',
  borderRadius: 10,
  padding: '0 6px',
  marginLeft: 6,
  lineHeight: '16px',
});

const ToolbarButton = styled('button')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 4,
  border: 'none',
  background: 'none',
  color: 'var(--ov-fg-faint, #8b949e)',
  cursor: 'pointer',
  padding: 0,
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'var(--ov-fg-default, #c9d1d9)',
  },
});

// ─── Component ──────────────────────────────────────────────────

const PluginsNav: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { plugins, available, installFromPath, installDev } = usePluginManager();
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const [search, setSearch] = React.useState('');
  const [installedOpen, setInstalledOpen] = React.useState(true);
  const [marketplaceOpen, setMarketplaceOpen] = React.useState(true);

  // Filter popover
  const [filterAnchor, setFilterAnchor] = React.useState<HTMLElement | null>(null);
  const [filters, setFilters] = React.useState<FilterState>({
    categories: new Set<string>(),
    sort: 'name' as SortOption,
  });
  const activeFilterCount = getActiveFilterCount(filters);

  // Overflow menu
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

  // Track installing plugin ids
  const [installingIds, setInstallingIds] = React.useState<Set<string>>(new Set());

  const installedIds = new Set(plugins.data?.map(p => p.id) ?? []);

  // Install mutation for marketplace inline install.
  // The marketplace listing may not include a latest_version, so resolve it
  // from the versions endpoint when missing — same path PluginUpdateButton uses.
  const installMutation = useMutation({
    mutationFn: async ({ pluginId, version }: { pluginId: string; version: string }) => {
      let installVersion = version;
      if (!installVersion) {
        const versions = await PluginManager.GetPluginVersions(pluginId);
        if (versions?.length) {
          installVersion = versions[0].version;
        }
      }
      if (!installVersion) {
        throw new Error('No versions available for this plugin');
      }
      return PluginManager.InstallPluginVersion(pluginId, installVersion);
    },
    onSuccess(meta) {
      showSnackbar({
        message: `${meta.name} installed successfully`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
      void queryClient.refetchQueries({ queryKey: ['plugins'] });
      EventsEmit('plugin/install_complete', meta);
      loadAndRegisterPlugin(meta.id);
      setInstallingIds(prev => {
        const next = new Set(prev);
        next.delete(meta.id);
        return next;
      });
    },
    onError: (err, variables) => {
      setInstallingIds(prev => {
        const next = new Set(prev);
        next.delete(variables.pluginId);
        return next;
      });
      createErrorHandler(showSnackbar, 'Plugin installation failed')(err);
    },
  });

  const handleInstall = (pluginId: string, version: string) => {
    setInstallingIds(prev => new Set(prev).add(pluginId));
    installMutation.mutate({ pluginId, version });
  };

  // Search filter — applies to both sections
  const searchLower = search.toLowerCase();

  const filteredInstalled = React.useMemo(() => {
    if (!plugins.data) return [];
    if (!searchLower) return plugins.data;
    return plugins.data.filter(p =>
      p.metadata?.name?.toLowerCase().includes(searchLower) ||
      p.metadata?.description?.toLowerCase().includes(searchLower) ||
      p.id?.toLowerCase().includes(searchLower)
    );
  }, [plugins.data, searchLower]);

  const filteredMarketplace = React.useMemo(() => {
    if (!available.data) return [];
    let items = available.data as any[];

    // Category filter
    if (filters.categories.size > 0) {
      items = items.filter(p => filters.categories.has(p.category));
    }

    // Search filter
    if (searchLower) {
      items = items.filter(p =>
        p.name?.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower) ||
        p.id?.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    items = [...items].sort((a, b) => {
      switch (filters.sort) {
        case 'downloads':
          return (b.download_count ?? 0) - (a.download_count ?? 0);
        case 'rating':
          return (b.average_rating ?? 0) - (a.average_rating ?? 0);
        case 'updated':
          return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        case 'name':
        default:
          return (a.name ?? '').localeCompare(b.name ?? '');
      }
    });

    return items;
  }, [available.data, filters, searchLower]);

  if (available.isLoading && plugins.isLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header toolbar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.5,
        py: 0.5,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <Box sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--ov-fg-faint, #8b949e)',
        }}>
          Plugins
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <ToolbarButton
            title='Refresh marketplace'
            onClick={() => available.refetch()}
          >
            <Box
              component='span'
              sx={{
                display: 'flex',
                alignItems: 'center',
                ...(available.isFetching && {
                  '@keyframes spin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                  },
                  animation: 'spin 1s linear infinite',
                }),
              }}
            >
              <LuRefreshCw size={14} />
            </Box>
          </ToolbarButton>
          <ToolbarButton
            title='Filter'
            onClick={(e) => setFilterAnchor(e.currentTarget)}
          >
            <Badge
              badgeContent={activeFilterCount}
              color='primary'
              sx={{
                '& .MuiBadge-badge': {
                  fontSize: '0.5625rem',
                  height: 14,
                  minWidth: 14,
                  padding: '0 3px',
                  right: -2,
                  top: -2,
                },
              }}
            >
              <LuSlidersHorizontal size={14} />
            </Badge>
          </ToolbarButton>
          <ToolbarButton
            title='More actions'
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <LuEllipsis size={14} />
          </ToolbarButton>
        </Box>
      </Box>

      {/* Search */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.5,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <LuSearch size={14} color='var(--ov-fg-faint, #8b949e)' style={{ flexShrink: 0 }} />
        <SearchInput
          placeholder='Search Extensions in Marketplace'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Installed section */}
        <SectionHeader onClick={() => setInstalledOpen(!installedOpen)}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {installedOpen
              ? <LuChevronDown size={12} color='var(--ov-fg-faint)' />
              : <LuChevronRight size={12} color='var(--ov-fg-faint)' />
            }
            <SectionLabel sx={{ ml: 0.5 }}>
              Installed
            </SectionLabel>
            {(filteredInstalled.length > 0) && (
              <CountBadge>{filteredInstalled.length}</CountBadge>
            )}
          </Box>
        </SectionHeader>
        <Collapse in={installedOpen}>
          <Box sx={{ pb: 0.5 }}>
            {filteredInstalled.map(p => (
              <PluginListItem
                key={p.id}
                id={p.id}
                name={p.metadata?.name || p.id}
                description={p.metadata?.description}
                icon={p.metadata?.icon}
                active={id === p.id}
                installed
                version={p.metadata?.version}
                phase={p.phase}
                devMode={p.devMode}
                author={p.metadata?.author?.name}
              />
            ))}
            {filteredInstalled.length === 0 && plugins.data && plugins.data.length > 0 && (
              <Box sx={{ px: 1.5, py: 1.5, textAlign: 'center', fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)' }}>
                No matching installed plugins
              </Box>
            )}
            {(!plugins.data || plugins.data.length === 0) && (
              <Box sx={{ px: 1.5, py: 1.5, textAlign: 'center', fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)' }}>
                No plugins installed
              </Box>
            )}
          </Box>
        </Collapse>

        {/* Marketplace section */}
        <SectionHeader onClick={() => setMarketplaceOpen(!marketplaceOpen)}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {marketplaceOpen
              ? <LuChevronDown size={12} color='var(--ov-fg-faint)' />
              : <LuChevronRight size={12} color='var(--ov-fg-faint)' />
            }
            <SectionLabel sx={{ ml: 0.5 }}>
              Marketplace
            </SectionLabel>
            {search && filteredMarketplace.length > 0 && (
              <CountBadge>{filteredMarketplace.length}</CountBadge>
            )}
          </Box>
        </SectionHeader>
        <Collapse in={marketplaceOpen}>
          <Box sx={{ pb: 0.5 }}>
            {filteredMarketplace.map((plugin: any) => (
              <PluginListItem
                key={plugin.id}
                id={plugin.id}
                name={plugin.name}
                description={plugin.description}
                icon={plugin.icon}
                iconUrl={plugin.icon_url}
                active={id === plugin.id}
                installed={installedIds.has(plugin.id)}
                publisherName={plugin.publisher_name}
                official={plugin.official}
                downloadCount={plugin.download_count}
                averageRating={plugin.average_rating}
                onInstall={
                  installedIds.has(plugin.id)
                    ? undefined
                    : () => handleInstall(plugin.id, plugin.latest_version)
                }
                installing={installingIds.has(plugin.id)}
              />
            ))}
            {filteredMarketplace.length === 0 && !available.isLoading && !available.isError && (
              <Box sx={{ px: 1.5, py: 2, textAlign: 'center', fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)' }}>
                No plugins found
              </Box>
            )}
            {available.isError && (
              <Box sx={{ px: 1.5, py: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <LuTriangleAlert size={18} color='var(--ov-warning-default, #d29922)' />
                <Box sx={{ fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)', textAlign: 'center' }}>
                  Could not reach marketplace
                </Box>
                <Box
                  component='button'
                  onClick={() => available.refetch()}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    fontSize: '0.6875rem', color: 'rgba(56,139,253,0.9)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    '&:hover': { color: 'rgba(56,139,253,1)' },
                  }}
                >
                  <LuRefreshCw size={11} />
                  Retry
                </Box>
              </Box>
            )}
            {available.isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={18} />
              </Box>
            )}
          </Box>
        </Collapse>
      </Box>

      {/* Filter popover */}
      <PluginFilterPopover
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Overflow menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 200,
              backgroundColor: 'var(--ov-bg-surface, #161b22)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              mt: 0.5,
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            installFromPath.mutateAsync();
          }}
          disabled={installFromPath.isPending}
          sx={{ fontSize: '0.8125rem' }}
        >
          <ListItemIcon sx={{ minWidth: '28px !important' }}>
            <LuFolderOpen size={15} />
          </ListItemIcon>
          <ListItemText>Install from File...</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            installDev.mutateAsync();
          }}
          disabled={installDev.isPending}
          sx={{ fontSize: '0.8125rem' }}
        >
          <ListItemIcon sx={{ minWidth: '28px !important' }}>
            <LuAtom size={15} />
          </ListItemIcon>
          <ListItemText>Install in Dev Mode...</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default PluginsNav;
