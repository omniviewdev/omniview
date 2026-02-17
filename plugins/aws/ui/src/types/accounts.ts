import { type types } from '@omniviewdev/runtime/models';

export type ViewMode = 'list' | 'grid';
export type SortByField = 'name' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface FilterState {
  status?: ('connected' | 'disconnected')[];
}

export interface ConnectionOverride {
  displayName?: string;
  description?: string;
  avatar?: string;
  tags?: string[];
}

export interface AccountPreferences {
  favorites: string[];
  connectionOverrides: Record<string, ConnectionOverride>;
}

export interface RecentEntry {
  lastAccessed: number;
  accessCount: number;
}

export interface EnrichedConnection {
  connection: types.Connection;
  isFavorite: boolean;
  isConnected: boolean;
  displayName: string;
  displayDescription: string;
  tags: string[];
  lastAccessed?: number;
  accessCount?: number;
}
