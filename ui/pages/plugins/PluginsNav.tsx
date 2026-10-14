import React from 'react';

import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Menu,
  SearchInput,
  Spinner,
} from '@omniviewdev/base-ui';

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

import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { usePluginService } from '@/features/plugins';
import PluginListItem from './PluginListItem';
import PluginFilterPopover, {
  getActiveFilterCount,
  type FilterState,
  type SortOption,
} from './PluginFilterPopover';
import styles from './PluginsNav.module.css';

// ─── Component ──────────────────────────────────────────────────

const PluginsNav: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { plugins, available, installFromPath, installDev } = usePluginManager();
  const { load } = usePluginService();
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
      if (!meta) {
        return;
      }

      showSnackbar({
        message: `${meta.name} installed successfully`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
      void queryClient.refetchQueries({ queryKey: ['plugins'] });
      void load(meta.id);
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
    if (!plugins.data) {
      return [];
    }

    if (!searchLower) {
      return plugins.data;
    }

    return plugins.data.filter(p =>
      p.metadata?.name?.toLowerCase().includes(searchLower) ||
      p.metadata?.description?.toLowerCase().includes(searchLower) ||
      p.id?.toLowerCase().includes(searchLower)
    );
  }, [plugins.data, searchLower]);

  const filteredMarketplace = React.useMemo(() => {
    if (!available.data) {
      return [];
    }

    let items = available.data as any[];

    // Category filter
    if (filters.categories.size > 0) {
      items = items.filter(p => filters.categories.has(p.category));
    }

    // Search filter
    if (searchLower) {
      items = items.filter(p =>
        p.name?.toLowerCase().includes(searchLower) === true ||
        p.description?.toLowerCase().includes(searchLower) === true ||
        p.id?.toLowerCase().includes(searchLower) === true
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
          break;
      }

      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    return items;
  }, [available.data, filters, searchLower]);

  if (available.isLoading && plugins.isLoading) {
    return (
      <div className={styles.Loading}>
        <Spinner size='md' />
      </div>
    );
  }

  return (
    <div className={styles.Root}>
      {/* Header toolbar */}
      <div className={styles.Toolbar}>
        <div className={styles.ToolbarTitle}>
          Plugins
        </div>
        <div className={styles.ToolbarActions}>
          <button
            type='button'
            className={styles.ToolbarButton}
            title='Refresh marketplace'
            onClick={() => {
              void available.refetch();
            }}
          >
            <span className={styles.RefreshIcon} data-spinning={available.isFetching ? 'true' : undefined}>
              <LuRefreshCw size={14} />
            </span>
          </button>
          <button
            type='button'
            className={styles.ToolbarButton}
            title='Filter'
            onClick={(e) => {
              setFilterAnchor(e.currentTarget); 
            }}
          >
            <Badge
              content={activeFilterCount}
              invisible={activeFilterCount === 0}
              color='brand'
              size='xs'
            >
              <LuSlidersHorizontal size={14} />
            </Badge>
          </button>
          <Menu.Root>
            <Menu.Trigger
              render={
                <button type='button' className={styles.ToolbarButton} title='More actions'>
                  <LuEllipsis size={14} />
                </button>
              }
            />
            <Menu.Portal>
              <Menu.Positioner side='bottom' align='end' sideOffset={4}>
                <Menu.Popup className={styles.MenuPopup}>
                  <Menu.Item
                    startDecorator={<LuFolderOpen size={15} />}
                    onClick={() => {
                      void installFromPath.mutateAsync();
                    }}
                    disabled={installFromPath.isPending}
                  >
                    Install from File...
                  </Menu.Item>
                  <Menu.Item
                    startDecorator={<LuAtom size={15} />}
                    onClick={() => {
                      void installDev.mutateAsync();
                    }}
                    disabled={installDev.isPending}
                  >
                    Install in Dev Mode...
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {/* Search */}
      <div className={styles.Search}>
        <SearchInput
          size='sm'
          placeholder='Search Extensions in Marketplace'
          value={search}
          onValueChange={setSearch}
          startDecorator={<LuSearch size={14} />}
          className={styles.SearchInput}
        />
      </div>

      {/* Scrollable content */}
      <div className={styles.Scroll}>
        {/* Installed section */}
        <Collapsible open={installedOpen} onOpenChange={setInstalledOpen}>
          <CollapsibleTrigger className={styles.SectionHeader}>
            <span className={styles.SectionHeaderInner}>
              {installedOpen
                ? <LuChevronDown size={12} color='var(--ov-color-fg-subtle)' />
                : <LuChevronRight size={12} color='var(--ov-color-fg-subtle)' />
              }
              <span className={styles.SectionLabel}>
                Installed
              </span>
              {(filteredInstalled.length > 0) && (
                <span className={styles.CountBadge}>{filteredInstalled.length}</span>
              )}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className={styles.SectionBody}>
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
                <div className={styles.EmptyMessage}>
                  No matching installed plugins
                </div>
              )}
              {(!plugins.data || plugins.data.length === 0) && (
                <div className={styles.EmptyMessage}>
                  No plugins installed
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Marketplace section */}
        <Collapsible open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
          <CollapsibleTrigger className={styles.SectionHeader}>
            <span className={styles.SectionHeaderInner}>
              {marketplaceOpen
                ? <LuChevronDown size={12} color='var(--ov-color-fg-subtle)' />
                : <LuChevronRight size={12} color='var(--ov-color-fg-subtle)' />
              }
              <span className={styles.SectionLabel}>
                Marketplace
              </span>
              {search && filteredMarketplace.length > 0 && (
                <span className={styles.CountBadge}>{filteredMarketplace.length}</span>
              )}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className={styles.SectionBody}>
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
                      : () => {
                        handleInstall(plugin.id, plugin.latest_version); 
                      }
                  }
                  installing={installingIds.has(plugin.id)}
                />
              ))}
              {filteredMarketplace.length === 0 && !available.isLoading && !available.isError && (
                <div className={`${styles.EmptyMessage} ${styles.EmptyMessageLarge}`}>
                  No plugins found
                </div>
              )}
              {available.isError && (
                <div className={styles.ErrorState}>
                  <LuTriangleAlert size={18} color='var(--ov-color-warning)' />
                  <div className={styles.ErrorText}>
                    Could not reach marketplace
                  </div>
                  <button
                    type='button'
                    className={styles.LinkButton}
                    onClick={() => {
                      void available.refetch();
                    }}
                  >
                    <LuRefreshCw size={11} />
                    Retry
                  </button>
                </div>
              )}
              {available.isLoading && (
                <div className={styles.SectionLoading}>
                  <Spinner size='sm' />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Filter popover */}
      <PluginFilterPopover
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => {
          setFilterAnchor(null); 
        }}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </div>
  );
};

export default PluginsNav;
