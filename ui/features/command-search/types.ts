import type { SearchEntryV1, SearchScopeV1, SearchProviderStatusV1 } from '@omniviewdev/runtime';
export type {
  AvailabilityV1, SettingTargetV1, NavigationTargetV1, HostCommandV1, SearchEntryV1,
  SearchProviderItemV1, SearchProviderResponseV1, SearchProviderRequestV1, SearchProviderV1,
  GlobalSearchContributionV1, SearchScopeV1, SearchActionReferenceV1, SearchExecutionContextV1,
  SearchProviderStatusV1,
} from '@omniviewdev/runtime';

export type SearchRow = {
  key: string;
  label: string;
  value: SearchEntryV1;
  disabledReason?: string;
  /** A "New <plugin> tab" entry: it opens in a new tab, background tab or window, never in the active tab. */
  opensNewTab?: true;
};

export type SearchSource = {
  id: string;
  label: string;
  state: 'queued' | 'pending' | 'complete' | 'truncated' | 'unavailable' | 'source-limit' | Exclude<SearchProviderStatusV1, 'ready'>;
  message?: string;
  retryable?: boolean;
};

export type SearchFeedback = {
  message: string;
  code?: string;
  requestId?: string;
};

export type SearchSnapshot = {
  isOpen: boolean;
  query: string;
  scopes: readonly SearchScopeV1[];
  selectedKey?: string;
  rows: readonly SearchRow[];
  sources: readonly SearchSource[];
  message?: string;
  /** Pending sources may leave previous-query rows visible but non-actionable. */
  searchPending: boolean;
  executionPending: boolean;
  feedback?: SearchFeedback;
};
