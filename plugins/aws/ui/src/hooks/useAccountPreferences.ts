import { useCallback, useMemo } from 'react';
import { usePluginData } from '@omniviewdev/runtime';
import type { ConnectionOverride, RecentEntry } from '../types/accounts';

const DEFAULT_FAVORITES: string[] = [];
const DEFAULT_OVERRIDES: Record<string, ConnectionOverride> = {};
const DEFAULT_RECENT: Record<string, RecentEntry> = {};

const MAX_RECENT_ENTRIES = 100;

export function useAccountPreferences(pluginID: string) {
  const {
    data: favorites,
    update: setFavorites,
    isLoading: favoritesLoading,
  } = usePluginData<string[]>(pluginID, 'account_favorites', DEFAULT_FAVORITES);

  const {
    data: connectionOverrides,
    update: setConnectionOverrides,
    isLoading: overridesLoading,
  } = usePluginData<Record<string, ConnectionOverride>>(pluginID, 'account_overrides', DEFAULT_OVERRIDES);

  const {
    data: recentConnections,
    update: setRecentConnections,
    isLoading: recentLoading,
  } = usePluginData<Record<string, RecentEntry>>(pluginID, 'account_recent', DEFAULT_RECENT);

  const toggleFavorite = useCallback(async (connectionId: string) => {
    const current = favorites ?? [];
    const next = current.includes(connectionId)
      ? current.filter(id => id !== connectionId)
      : [...current, connectionId];
    await setFavorites(next);
  }, [favorites, setFavorites]);

  const updateOverride = useCallback(async (connectionId: string, override: ConnectionOverride) => {
    const current = connectionOverrides ?? {};
    await setConnectionOverrides({ ...current, [connectionId]: override });
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
    connectionOverrides: connectionOverrides ?? DEFAULT_OVERRIDES,
    recentConnections: recentConnections ?? DEFAULT_RECENT,
    availableTags,
    isLoading: favoritesLoading || overridesLoading || recentLoading,
    toggleFavorite,
    updateOverride,
    recordAccess,
  };
}
