import { useMemo } from 'react';
import { type types } from '@omniviewdev/runtime/models';
import type {
  GroupByMode,
  SortByField,
  SortDirection,
  FilterState,
  EnrichedConnection,
  GroupedConnectionsResult,
  GroupedSection,
  ConnectionOverride,
  ConnectionGroup,
  ConnectionAttribute,
  RecentEntry,
} from '../types/clusters';
import { LEGACY_GROUP_ALIASES, LEGACY_SORT_ALIASES } from '../types/clusters';
import { detectProvider, getProviderLabel } from '../utils/providers';

interface UseConnectionGroupingOpts {
  connections: types.Connection[];
  favorites: string[];
  connectionOverrides: Record<string, ConnectionOverride>;
  customGroups: ConnectionGroup[];
  recentConnections: Record<string, RecentEntry>;
  search: string;
  groupBy: GroupByMode;
  sortBy: SortByField;
  sortDirection: SortDirection;
  filters: FilterState;
}

function isConnected(conn: types.Connection): boolean {
  const refreshTime = new Date(conn.last_refresh);
  if (refreshTime.toString() === 'Invalid Date') return false;
  return (refreshTime.getTime() + conn.expiry_time) > Date.now();
}

function enrichConnection(
  conn: types.Connection,
  favorites: string[],
  overrides: Record<string, ConnectionOverride>,
  recentConnections: Record<string, RecentEntry>,
): EnrichedConnection {
  const override = overrides[conn.id];
  const recent = recentConnections[conn.id];
  return {
    connection: conn,
    provider: detectProvider(conn),
    isFavorite: favorites.includes(conn.id),
    isConnected: isConnected(conn),
    displayName: override?.displayName || conn.name,
    displayDescription: override?.description || conn.description || '',
    tags: override?.tags ?? [],
    lastAccessed: recent?.lastAccessed,
    accessCount: recent?.accessCount,
  };
}

function matchesSearch(enriched: EnrichedConnection, search: string): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  const conn = enriched.connection;

  if (enriched.displayName.toLowerCase().includes(s)) return true;
  if (conn.id.toLowerCase().includes(s)) return true;
  if (enriched.displayDescription.toLowerCase().includes(s)) return true;
  if (enriched.provider.toLowerCase().includes(s)) return true;

  // Search across tags
  for (const tag of enriched.tags) {
    if (tag.toLowerCase().includes(s)) return true;
  }

  // Search across all label values
  if (conn.labels) {
    for (const val of Object.values(conn.labels)) {
      if (String(val).toLowerCase().includes(s)) return true;
    }
  }

  // Search across all data values
  if (conn.data) {
    for (const val of Object.values(conn.data)) {
      if (String(val).toLowerCase().includes(s)) return true;
    }
  }

  return false;
}

function matchesFilters(enriched: EnrichedConnection, filters: FilterState): boolean {
  if (filters.providers?.length && !filters.providers.includes(enriched.provider)) {
    return false;
  }
  if (filters.status?.length) {
    const connStatus = enriched.isConnected ? 'connected' : 'disconnected';
    if (!filters.status.includes(connStatus)) return false;
  }
  if (filters.tags?.length) {
    if (!filters.tags.some(tag => enriched.tags.includes(tag))) return false;
  }
  if (filters.labels) {
    for (const [key, values] of Object.entries(filters.labels)) {
      if (!values.length) continue;
      const labelVal = String(enriched.connection.labels?.[key] ?? '');
      if (!values.includes(labelVal)) return false;
    }
  }
  return true;
}

/** Resolve a groupBy or sortBy value that might be a legacy alias to a label key. */
function resolveLabelKey(mode: string): string | undefined {
  if (mode in LEGACY_GROUP_ALIASES) return LEGACY_GROUP_ALIASES[mode];
  if (mode.startsWith('label:')) return mode.slice(6);
  return undefined;
}

function resolveSortLabelKey(mode: string): string | undefined {
  if (mode in LEGACY_SORT_ALIASES) return LEGACY_SORT_ALIASES[mode];
  if (mode.startsWith('label:')) return mode.slice(6);
  return undefined;
}

function sortConnections(
  connections: EnrichedConnection[],
  sortBy: SortByField,
  sortDirection: SortDirection,
): EnrichedConnection[] {
  const sorted = [...connections];
  const dir = sortDirection === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    let aVal: string;
    let bVal: string;

    // Check for label-based sort first
    const labelKey = resolveSortLabelKey(sortBy);
    if (labelKey) {
      aVal = String(a.connection.labels?.[labelKey] ?? '').toLowerCase();
      bVal = String(b.connection.labels?.[labelKey] ?? '').toLowerCase();
    } else {
      switch (sortBy) {
        case 'name':
          aVal = a.displayName.toLowerCase();
          bVal = b.displayName.toLowerCase();
          break;
        case 'provider':
          aVal = a.provider;
          bVal = b.provider;
          break;
        case 'status':
          aVal = a.isConnected ? '0' : '1';
          bVal = b.isConnected ? '0' : '1';
          break;
        case 'recency': {
          // Sort by lastAccessed descending by default (most recent first)
          const aTime = a.lastAccessed ?? 0;
          const bTime = b.lastAccessed ?? 0;
          if (aTime < bTime) return 1 * dir;
          if (aTime > bTime) return -1 * dir;
          return 0;
        }
        default:
          aVal = a.displayName.toLowerCase();
          bVal = b.displayName.toLowerCase();
      }
    }

    if (aVal! < bVal!) return -1 * dir;
    if (aVal! > bVal!) return 1 * dir;
    return 0;
  });

  return sorted;
}

function getRecencyBucket(timestamp?: number): { key: string; label: string; order: number } {
  if (!timestamp) return { key: 'never', label: 'Never Used', order: 5 };
  const now = Date.now();
  const diff = now - timestamp;
  const oneDay = 86400000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;

  if (diff < oneDay) return { key: 'today', label: 'Today', order: 1 };
  if (diff < oneWeek) return { key: 'this-week', label: 'This Week', order: 2 };
  if (diff < oneMonth) return { key: 'this-month', label: 'This Month', order: 3 };
  return { key: 'older', label: 'Older', order: 4 };
}

function groupConnections(
  connections: EnrichedConnection[],
  groupBy: GroupByMode,
  customGroups: ConnectionGroup[],
): GroupedSection[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All Clusters', connections }];
  }

  if (groupBy === 'favorites') {
    const favs = connections.filter(c => c.isFavorite);
    const rest = connections.filter(c => !c.isFavorite);
    const groups: GroupedSection[] = [];
    if (favs.length > 0) {
      groups.push({ key: 'favorites', label: 'Favorites', connections: favs });
    }
    if (rest.length > 0) {
      groups.push({ key: 'other', label: 'Other', connections: rest });
    }
    return groups;
  }

  if (groupBy === 'custom') {
    const groups: GroupedSection[] = [];
    const assigned = new Set<string>();

    for (const group of customGroups) {
      const groupConns = connections.filter(c => group.connectionIds.includes(c.connection.id));
      if (groupConns.length > 0) {
        groups.push({ key: group.id, label: group.name, connections: groupConns });
        groupConns.forEach(c => assigned.add(c.connection.id));
      }
    }

    const unassigned = connections.filter(c => !assigned.has(c.connection.id));
    if (unassigned.length > 0) {
      groups.push({ key: 'ungrouped', label: 'Ungrouped', connections: unassigned });
    }
    return groups;
  }

  if (groupBy === 'tags') {
    const tagMap = new Map<string, EnrichedConnection[]>();
    const untagged: EnrichedConnection[] = [];

    for (const conn of connections) {
      if (conn.tags.length === 0) {
        untagged.push(conn);
      } else {
        for (const tag of conn.tags) {
          const existing = tagMap.get(tag);
          if (existing) {
            existing.push(conn);
          } else {
            tagMap.set(tag, [conn]);
          }
        }
      }
    }

    const groups: GroupedSection[] = Array.from(tagMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, conns]) => ({ key: `tag:${tag}`, label: tag, connections: conns }));

    if (untagged.length > 0) {
      groups.push({ key: 'untagged', label: 'Untagged', connections: untagged });
    }
    return groups;
  }

  if (groupBy === 'recent') {
    const bucketMap = new Map<string, { label: string; order: number; connections: EnrichedConnection[] }>();

    for (const conn of connections) {
      const bucket = getRecencyBucket(conn.lastAccessed);
      const existing = bucketMap.get(bucket.key);
      if (existing) {
        existing.connections.push(conn);
      } else {
        bucketMap.set(bucket.key, { label: bucket.label, order: bucket.order, connections: [conn] });
      }
    }

    return Array.from(bucketMap.entries())
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, { label, connections: conns }]) => ({ key, label, connections: conns }));
  }

  // Check for label-based grouping (including legacy aliases like 'kubeconfig', 'user')
  const labelKey = resolveLabelKey(groupBy);
  if (labelKey) {
    const groupMap = new Map<string, EnrichedConnection[]>();

    for (const conn of connections) {
      const value = String(conn.connection.labels?.[labelKey] ?? 'Unknown');
      const existing = groupMap.get(value);
      if (existing) {
        existing.push(conn);
      } else {
        groupMap.set(value, [conn]);
      }
    }

    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, conns]) => ({ key, label: key, connections: conns }));
  }

  // Special computed grouping modes
  const groupMap = new Map<string, { label: string; provider?: string; connections: EnrichedConnection[] }>();

  for (const conn of connections) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case 'provider':
        key = conn.provider;
        label = getProviderLabel(conn.provider);
        break;
      case 'status':
        key = conn.isConnected ? 'connected' : 'disconnected';
        label = conn.isConnected ? 'Connected' : 'Disconnected';
        break;
      default:
        key = 'all';
        label = 'All';
    }

    const existing = groupMap.get(key);
    if (existing) {
      existing.connections.push(conn);
    } else {
      groupMap.set(key, {
        label,
        provider: groupBy === 'provider' ? key : undefined,
        connections: [conn],
      });
    }
  }

  return Array.from(groupMap.entries()).map(([key, group]) => ({
    key,
    label: group.label,
    provider: group.provider,
    connections: group.connections,
  }));
}

function formatAttributeName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function discoverAttributes(connections: types.Connection[]): ConnectionAttribute[] {
  const attrMap = new Map<string, Set<string>>();
  const total = connections.length;

  for (const conn of connections) {
    if (!conn.labels) continue;
    for (const [key, val] of Object.entries(conn.labels)) {
      if (!attrMap.has(key)) attrMap.set(key, new Set());
      attrMap.get(key)!.add(String(val));
    }
  }

  return Array.from(attrMap.entries())
    .filter(([, values]) => values.size >= 2)
    .map(([key, values]) => {
      // Count how many connections have this key
      let count = 0;
      for (const conn of connections) {
        if (conn.labels && key in conn.labels) count++;
      }

      return {
        key,
        displayName: formatAttributeName(key),
        distinctValues: [...values].sort(),
        coverage: total > 0 ? count / total : 0,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Pure computation hook that takes connections + preferences + UI state
 * and returns grouped, filtered, sorted results with dynamic attribute metadata.
 */
export function useConnectionGrouping(opts: UseConnectionGroupingOpts): GroupedConnectionsResult {
  return useMemo(() => {
    const {
      connections,
      favorites,
      connectionOverrides,
      customGroups,
      recentConnections,
      search,
      groupBy,
      sortBy,
      sortDirection,
      filters,
    } = opts;

    // 1. Enrich connections
    const enriched = connections.map(c =>
      enrichConnection(c, favorites, connectionOverrides, recentConnections),
    );

    // 2. Collect available providers (before filtering)
    const availableProviders = [...new Set(enriched.map(c => c.provider))].sort();

    // 3. Discover attributes from raw connections
    const availableAttributes = discoverAttributes(connections);

    // 4. Collect all tags
    const availableTags = [...new Set(enriched.flatMap(c => c.tags))].sort();

    // 5. Filter by search + filter chips
    const filtered = enriched.filter(c =>
      matchesSearch(c, search) && matchesFilters(c, filters),
    );

    // 6. Group
    const groups = groupConnections(filtered, groupBy, customGroups);

    // 7. Sort within groups
    const sortedGroups = groups.map(g => ({
      ...g,
      connections: sortConnections(g.connections, sortBy, sortDirection),
    }));

    // 8. Pin favorites group to top if it exists
    sortedGroups.sort((a, b) => {
      if (a.key === 'favorites') return -1;
      if (b.key === 'favorites') return 1;
      return 0;
    });

    return {
      groups: sortedGroups,
      totalCount: connections.length,
      filteredCount: filtered.length,
      availableProviders,
      availableAttributes,
      availableTags,
    };
  }, [opts]);
}
