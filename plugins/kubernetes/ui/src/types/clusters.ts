import { type types } from '@omniviewdev/runtime/models';

// Special grouping modes + dynamic label-based grouping via `label:${string}`
export type GroupByMode =
  | 'none' | 'provider' | 'status' | 'favorites' | 'custom'
  | 'tags'
  | 'recent'
  | `label:${string}`;

// Legacy aliases that map to label-based grouping
export const LEGACY_GROUP_ALIASES: Record<string, string> = {
  kubeconfig: 'kubeconfig',
  user: 'user',
  cluster: 'cluster',
};

export type SortByField =
  | 'name' | 'provider' | 'status'
  | 'recency'
  | `label:${string}`;

// Legacy aliases that map to label-based sorting
export const LEGACY_SORT_ALIASES: Record<string, string> = {
  cluster: 'cluster',
  kubeconfig: 'kubeconfig',
  user: 'user',
};

export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'list' | 'grid';

export interface FilterState {
  providers?: string[];
  status?: ('connected' | 'disconnected')[];
  tags?: string[];
  labels?: Record<string, string[]>;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  connectionIds: string[];
}

export interface ConnectionOverride {
  displayName?: string;
  description?: string;
  avatar?: string;
  avatarColor?: string;
  tags?: string[];
}

export interface ClusterPreferences {
  favorites: string[];
  customGroups: ConnectionGroup[];
  connectionOverrides: Record<string, ConnectionOverride>;
}

export interface RecentEntry {
  lastAccessed: number;
  accessCount: number;
}

export interface EnrichedConnection {
  connection: types.Connection;
  provider: string;
  isFavorite: boolean;
  isConnected: boolean;
  displayName: string;
  displayDescription: string;
  avatar?: string;
  avatarColor?: string;
  tags: string[];
  lastAccessed?: number;
  accessCount?: number;
}

export interface GroupedSection {
  key: string;
  label: string;
  provider?: string;
  connections: EnrichedConnection[];
}

export interface ConnectionAttribute {
  key: string;
  displayName: string;
  distinctValues: string[];
  coverage: number;
}

export interface GroupedConnectionsResult {
  groups: GroupedSection[];
  totalCount: number;
  filteredCount: number;
  availableProviders: string[];
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
}

export type HubSectionType = 'connected' | 'recent' | 'favorites' | 'browse' | `group:${string}`;

export interface HubSectionConfig {
  type: HubSectionType;
  collapsed: boolean;
}
