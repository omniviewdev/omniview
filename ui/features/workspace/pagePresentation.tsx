import type { ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { LuFile, LuHouse, LuPuzzle, LuSettings } from 'react-icons/lu';
import { connectionListQueryKey } from '@omniviewdev/runtime';
import { PluginManager, ResourceClient } from '@omniviewdev/runtime/api';
import Icon from '@/components/icons/Icon';
import { IsImage } from '@/utils/url';
import { derivePageTitle, parsePagePath, type PageTitleLookup } from './pagePaths';
import type { PageTab } from './pagesState';
import styles from './components/Workspace.module.css';

const ICON_SIZE = 14;
const CONNECTION_LIST_STALE_MS = 30_000;

export type PagePresentation = {
  /** Title derived from the path, or null until plugin and connection names are known. */
  derivedTitleOf: (tab: PageTab) => string | null;
  /** Title to show: derived, else the last cached title, else the path. */
  titleOf: (tab: PageTab) => string;
  iconOf: (tab: PageTab) => ReactNode;
};

/**
 * Names and icons for page tabs, from the plugin inventory the new-tab
 * launcher uses and the connection lists plugins load (same query keys, so the data
 * is shared with plugin pages).
 */
export function usePagePresentation(tabs: readonly PageTab[]): PagePresentation {
  // Observe the inventory the new-tab launcher loads; do not fetch it again.
  const inventory = useQuery({ queryKey: ['plugins'], queryFn: PluginManager.ListPlugins, enabled: false });
  const connectionPluginIds = [...new Set(tabs.flatMap((tab) => {
    const target = parsePagePath(tab.path);
    return target.kind === 'connection' ? [target.pluginId] : [];
  }))].toSorted();
  const connectionLists = useQueries({
    queries: connectionPluginIds.map((pluginId) => ({
      queryKey: connectionListQueryKey(pluginId),
      queryFn: async () => ResourceClient.ListConnections(pluginId),
      staleTime: CONNECTION_LIST_STALE_MS,
      retry: false,
    })),
  });

  const pluginMeta = new Map((inventory.data ?? []).map((plugin) => [plugin.id, plugin.metadata]));
  const connectionNames = new Map<string, string>();
  connectionPluginIds.forEach((pluginId, index) => {
    for (const connection of connectionLists[index].data ?? []) {
      connectionNames.set(`${pluginId}\u0000${connection.id}`, connection.name || connection.id);
    }
  });

  const lookup: PageTitleLookup = {
    pluginName: (pluginId) => {
      const name = pluginMeta.get(pluginId)?.name;
      return name === '' ? undefined : name;
    },
    connectionName: (pluginId, connectionId) => connectionNames.get(`${pluginId}\u0000${connectionId}`),
  };

  const derivedTitleOf = (tab: PageTab) => derivePageTitle(tab.path, lookup);

  return {
    derivedTitleOf,
    titleOf: (tab) => derivedTitleOf(tab) ?? tab.title ?? tab.path,
    iconOf: (tab) => {
      const target = parsePagePath(tab.path);
      switch (target.kind) {
        case 'home':
          return <LuHouse size={ICON_SIZE} />;
        case 'plugins':
          return <LuPuzzle size={ICON_SIZE} />;
        case 'settings':
          return <LuSettings size={ICON_SIZE} />;
        case 'plugin':
        case 'connection': {
          const icon = pluginMeta.get(target.pluginId)?.icon;
          if (!icon) {
            return <LuPuzzle size={ICON_SIZE} />;
          }

          return IsImage(icon)
            ? <img src={icon} alt='' className={styles.TabImageIcon} />
            : <Icon name={icon} size={ICON_SIZE} />;
        }

        case 'unknown':
          return <LuFile size={ICON_SIZE} />;
      }
    },
  };
}
