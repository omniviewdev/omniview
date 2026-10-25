export type AvailabilityV1 = { state: 'enabled' } | { state: 'disabled'; reason: string };

export type SettingTargetV1 =
  | { section: 'core'; categoryId: string; settingId?: string }
  | { section: 'plugins'; pluginId: string; settingId?: string }
  | { section: 'extensions' };

export type NavigationTargetV1 =
  | { kind: 'core'; path: '/' | '/plugins' }
  | { kind: 'plugin'; pluginId: string; path: string };

export type HostCommandV1 = { kind: 'reload-connections'; pluginId: string };

export type SearchEntryV1 = {
  schemaVersion: 1;
  description?: string;
  keywords?: readonly string[];
  availability?: AvailabilityV1;
} & (
  | { kind: 'command'; command: HostCommandV1 }
  | { kind: 'setting'; target: SettingTargetV1 }
  | { kind: 'navigation'; target: NavigationTargetV1 }
);

export type SearchProviderItemV1 = {
  id: string;
  label: string;
  value: SearchEntryV1;
};

export type SearchProviderResponseV1 = {
  items: readonly SearchProviderItemV1[];
  completion: 'complete' | 'truncated';
};

export type SearchProviderRequestV1 = {
  query: string;
  signal: AbortSignal;
  limit: number;
};

export type SearchProviderV1 = {
  schemaVersion: 1;
  kind: 'provider';
  search(request: SearchProviderRequestV1): Promise<SearchProviderResponseV1>;
};

export type GlobalSearchContributionV1 = SearchEntryV1 | SearchProviderV1;

export type SearchRow = {
  key: string;
  label: string;
  value: SearchEntryV1;
  disabledReason?: string;
};

export type SearchSource = {
  id: string;
  label: string;
  state: 'queued' | 'pending' | 'complete' | 'truncated' | 'unavailable' | 'source-limit';
};

export type SearchFeedback = {
  message: string;
  code?: string;
  requestId?: string;
};

export type SearchSnapshot = {
  isOpen: boolean;
  query: string;
  rows: readonly SearchRow[];
  sources: readonly SearchSource[];
  message?: string;
  executionPending: boolean;
  feedback?: SearchFeedback;
};
