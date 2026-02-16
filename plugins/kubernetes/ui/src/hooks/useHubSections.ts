import { useMemo, useCallback } from 'react';
import type {
  EnrichedConnection,
  ConnectionAttribute,
  ConnectionGroup,
  HubSectionConfig,
  HubSectionType,
} from '../types/clusters';

export interface HubSectionData {
  config: HubSectionConfig;
  title: string;
  data: EnrichedConnection[];
  emptyHint: string;
  variant: 'list' | 'grid';
  groupId?: string;
  groupColor?: string;
  groupIcon?: string;
}

interface UseHubSectionsParams {
  enrichedConnections: EnrichedConnection[];
  hubSectionConfigs: HubSectionConfig[];
  customGroups: ConnectionGroup[];
  availableAttributes: ConnectionAttribute[];
}

/**
 * Orchestrates hub section data: merges configs with custom groups,
 * computes filtered/sorted data per section, and provides reorder logic.
 */
export function useHubSections({
  enrichedConnections,
  hubSectionConfigs,
  customGroups,
  availableAttributes,
}: UseHubSectionsParams) {
  // Merge custom group sections that exist but aren't in config
  const mergedConfigs = useMemo(() => {
    const configs = [...hubSectionConfigs];
    const existingTypes = new Set(configs.map(c => c.type));

    // Remove config entries for deleted custom groups
    const validGroupIds = new Set(customGroups.map(g => g.id));
    const filtered = configs.filter(c => {
      if (c.type.startsWith('group:')) {
        const groupId = c.type.slice(6);
        return validGroupIds.has(groupId);
      }
      return true;
    });

    // Add missing custom groups before 'browse'
    for (const group of customGroups) {
      const sectionType: HubSectionType = `group:${group.id}`;
      if (!existingTypes.has(sectionType)) {
        const browseIdx = filtered.findIndex(c => c.type === 'browse');
        const insertAt = browseIdx >= 0 ? browseIdx : filtered.length;
        filtered.splice(insertAt, 0, { type: sectionType, collapsed: false });
      }
    }

    return filtered;
  }, [hubSectionConfigs, customGroups]);

  // Compute section data
  const sections = useMemo<HubSectionData[]>(() => {
    return mergedConfigs.map(config => {
      switch (config.type) {
        case 'connected':
          return {
            config,
            title: 'Connected',
            data: enrichedConnections.filter(c => c.isConnected),
            emptyHint: 'Click a cluster to connect',
            variant: 'list' as const,
          };

        case 'recent': {
          const data = enrichedConnections
            .filter(c => c.lastAccessed)
            .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
            .slice(0, 8);
          return {
            config,
            title: 'Recently Used',
            data,
            emptyHint: '',
            variant: 'list' as const,
          };
        }

        case 'favorites':
          return {
            config,
            title: 'Favorites',
            data: enrichedConnections.filter(c => c.isFavorite),
            emptyHint: 'Star clusters from All Clusters',
            variant: 'list' as const,
          };

        case 'browse':
          return {
            config,
            title: 'Browse',
            data: enrichedConnections,
            emptyHint: '',
            variant: 'grid' as const,
          };

        default: {
          // Custom group: `group:${groupId}`
          if (config.type.startsWith('group:')) {
            const groupId = config.type.slice(6);
            const group = customGroups.find(g => g.id === groupId);
            if (!group) {
              return {
                config,
                title: 'Unknown Group',
                data: [],
                emptyHint: 'Group not found',
                variant: 'list' as const,
              };
            }
            const memberSet = new Set(group.connectionIds);
            return {
              config,
              title: group.name,
              data: enrichedConnections.filter(c => memberSet.has(c.connection.id)),
              emptyHint: 'Drag clusters here or assign from context menu',
              variant: 'list' as const,
              groupId: group.id,
              groupColor: group.color,
              groupIcon: group.icon,
            };
          }
          return {
            config,
            title: config.type,
            data: [],
            emptyHint: '',
            variant: 'list' as const,
          };
        }
      }
    });
  }, [mergedConfigs, enrichedConnections, customGroups, availableAttributes]);

  const reorderSections = useCallback(
    (activeId: string, overId: string): HubSectionConfig[] => {
      const oldIndex = mergedConfigs.findIndex(c => c.type === activeId);
      const newIndex = mergedConfigs.findIndex(c => c.type === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return mergedConfigs;
      const next = [...mergedConfigs];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    },
    [mergedConfigs],
  );

  return { sections, mergedConfigs, reorderSections };
}
