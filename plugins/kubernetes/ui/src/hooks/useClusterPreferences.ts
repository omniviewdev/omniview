import { useCallback, useMemo } from 'react';
import { usePluginData } from '@omniviewdev/runtime';
import type { ConnectionOverride, ConnectionGroup, RecentEntry, HubSectionConfig } from '../types/clusters';

const DEFAULT_FAVORITES: string[] = [];
const DEFAULT_GROUPS: ConnectionGroup[] = [];
const DEFAULT_OVERRIDES: Record<string, ConnectionOverride> = {};
const DEFAULT_RECENT: Record<string, RecentEntry> = {};
const DEFAULT_HUB_SECTIONS: HubSectionConfig[] = [
  { type: 'connected', collapsed: false },
  { type: 'recent', collapsed: false },
  { type: 'favorites', collapsed: false },
  { type: 'browse', collapsed: false },
];

const MAX_RECENT_ENTRIES = 100;

/**
 * Manages cluster preferences backed by the Plugin Data Store.
 * Wraps usePluginData calls for favorites, custom groups, per-connection overrides, and recency tracking.
 */
export function useClusterPreferences(pluginID: string) {
  const {
    data: favorites,
    update: setFavorites,
    isLoading: favoritesLoading,
  } = usePluginData<string[]>(pluginID, 'cluster_favorites', DEFAULT_FAVORITES);

  const {
    data: customGroups,
    update: setCustomGroups,
    isLoading: groupsLoading,
  } = usePluginData<ConnectionGroup[]>(pluginID, 'cluster_groups', DEFAULT_GROUPS);

  const {
    data: connectionOverrides,
    update: setConnectionOverrides,
    isLoading: overridesLoading,
  } = usePluginData<Record<string, ConnectionOverride>>(pluginID, 'cluster_overrides', DEFAULT_OVERRIDES);

  const {
    data: recentConnections,
    update: setRecentConnections,
    isLoading: recentLoading,
  } = usePluginData<Record<string, RecentEntry>>(pluginID, 'cluster_recent', DEFAULT_RECENT);

  const {
    data: hubSections,
    update: setHubSectionsRaw,
    isLoading: hubSectionsLoading,
  } = usePluginData<HubSectionConfig[]>(pluginID, 'hub_sections', DEFAULT_HUB_SECTIONS);

  const setHubSections = useCallback(async (sections: HubSectionConfig[]) => {
    await setHubSectionsRaw(sections);
  }, [setHubSectionsRaw]);

  const updateHubSectionCollapsed = useCallback(async (sectionType: string, collapsed: boolean) => {
    const current = hubSections ?? DEFAULT_HUB_SECTIONS;
    await setHubSectionsRaw(current.map(s =>
      s.type === sectionType ? { ...s, collapsed } : s,
    ));
  }, [hubSections, setHubSectionsRaw]);

  const toggleFavorite = useCallback(async (connectionId: string) => {
    const current = favorites ?? [];
    const next = current.includes(connectionId)
      ? current.filter(id => id !== connectionId)
      : [...current, connectionId];
    await setFavorites(next);
  }, [favorites, setFavorites]);

  const addGroup = useCallback(async (group: ConnectionGroup) => {
    const current = customGroups ?? [];
    await setCustomGroups([...current, group]);
  }, [customGroups, setCustomGroups]);

  const removeGroup = useCallback(async (groupId: string) => {
    const current = customGroups ?? [];
    await setCustomGroups(current.filter(g => g.id !== groupId));
  }, [customGroups, setCustomGroups]);

  const assignToGroup = useCallback(async (groupId: string, connectionId: string) => {
    const current = customGroups ?? [];
    await setCustomGroups(current.map(g => {
      if (g.id !== groupId) return g;
      if (g.connectionIds.includes(connectionId)) return g;
      return { ...g, connectionIds: [...g.connectionIds, connectionId] };
    }));
  }, [customGroups, setCustomGroups]);

  const removeFromGroup = useCallback(async (groupId: string, connectionId: string) => {
    const current = customGroups ?? [];
    await setCustomGroups(current.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, connectionIds: g.connectionIds.filter(id => id !== connectionId) };
    }));
  }, [customGroups, setCustomGroups]);

  const updateGroup = useCallback(async (groupId: string, updates: { name?: string; color?: string; icon?: string }) => {
    const current = customGroups ?? [];
    await setCustomGroups(current.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, ...updates };
    }));
  }, [customGroups, setCustomGroups]);

  const updateOverride = useCallback(async (connectionId: string, override: ConnectionOverride) => {
    const current = connectionOverrides ?? {};
    await setConnectionOverrides({ ...current, [connectionId]: override });
  }, [connectionOverrides, setConnectionOverrides]);

  const removeOverride = useCallback(async (connectionId: string) => {
    const current = connectionOverrides ?? {};
    const next = { ...current };
    delete next[connectionId];
    await setConnectionOverrides(next);
  }, [connectionOverrides, setConnectionOverrides]);

  const recordAccess = useCallback(async (connectionId: string) => {
    const current = recentConnections ?? {};
    const existing = current[connectionId];
    const next = {
      ...current,
      [connectionId]: {
        lastAccessed: Date.now(),
        accessCount: (existing?.accessCount ?? 0) + 1,
      },
    };

    // Prune oldest entries if over limit
    const keys = Object.keys(next);
    if (keys.length > MAX_RECENT_ENTRIES) {
      const sorted = keys.sort((a, b) => (next[a].lastAccessed ?? 0) - (next[b].lastAccessed ?? 0));
      const toRemove = sorted.slice(0, keys.length - MAX_RECENT_ENTRIES);
      for (const key of toRemove) {
        delete next[key];
      }
    }

    await setRecentConnections(next);
  }, [recentConnections, setRecentConnections]);

  // Collect all tags used across all connection overrides
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const override of Object.values(connectionOverrides ?? {})) {
      if (override.tags) {
        for (const tag of override.tags) {
          tags.add(tag);
        }
      }
    }
    return [...tags].sort();
  }, [connectionOverrides]);

  return {
    favorites: favorites ?? DEFAULT_FAVORITES,
    customGroups: customGroups ?? DEFAULT_GROUPS,
    connectionOverrides: connectionOverrides ?? DEFAULT_OVERRIDES,
    recentConnections: recentConnections ?? DEFAULT_RECENT,
    hubSections: hubSections ?? DEFAULT_HUB_SECTIONS,
    availableTags,
    isLoading: favoritesLoading || groupsLoading || overridesLoading || recentLoading || hubSectionsLoading,
    toggleFavorite,
    addGroup,
    removeGroup,
    assignToGroup,
    removeFromGroup,
    updateGroup,
    updateOverride,
    removeOverride,
    recordAccess,
    setHubSections,
    updateHubSectionCollapsed,
  };
}
