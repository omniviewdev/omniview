import { classifyFrontendError, recordFrontendSpan } from '@omniviewdev/runtime';

export type QueryFailureCategory = 'resource' | 'plugin' | 'settings' | 'connection' | 'metric' | 'logs' | 'exec' | 'networker' | 'other';

const FIRST_SEGMENT_CATEGORIES: Readonly<Record<string, QueryFailureCategory>> = {
  plugins: 'plugin',
  plugin: 'plugin',
  settings: 'settings',
  connection: 'connection',
  connections: 'connection',
  metric: 'metric',
  metrics: 'metric',
  logs: 'logs',
  exec: 'exec',
  networker: 'networker',
  resource: 'resource',
  'resource-v2': 'resource',
};

/**
 * Maps a query/mutation key to a closed category using at most its first two
 * segments. Plugin-scoped keys lead with the plugin id, so the second segment
 * decides. The key itself is never exported.
 */
export function queryFailureCategory(key: readonly unknown[] | undefined): QueryFailureCategory {
  const [first, second] = key ?? [];
  if (typeof first === 'string' && Object.hasOwn(FIRST_SEGMENT_CATEGORIES, first)) {
    return FIRST_SEGMENT_CATEGORIES[first];
  }

  if (typeof second === 'string' && Object.hasOwn(FIRST_SEGMENT_CATEGORIES, second)) {
    return FIRST_SEGMENT_CATEGORIES[second];
  }

  return 'other';
}

/** Records one terminal query or mutation failure as a `frontend.query.failure` span. */
export function recordQueryFailure(
  kind: 'query' | 'mutation',
  error: unknown,
  key: readonly unknown[] | undefined,
  failureCount: number,
): void {
  const errorClass = classifyFrontendError(error);
  const canceled = errorClass === 'canceled';
  const now = Date.now();
  recordFrontendSpan('frontend.query.failure', {
    kind,
    category: queryFailureCategory(key),
    failure_count: Math.min(Math.max(failureCount, 0), 1000),
    canceled,
    outcome: canceled ? 'canceled' : 'failure',
    error_class: errorClass,
  }, now, now, !canceled);
}
