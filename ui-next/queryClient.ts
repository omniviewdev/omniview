import { QueryClient } from '@tanstack/react-query';

/**
 * The one QueryClient of the new shell; a screen never builds its own.
 *
 * The old shell sets `refetchOnWindowFocus: false` for every query (`ui/App.tsx:110-114`), and the runtime's catalog hooks state their
 * own focus behaviour because of it. A bare `new QueryClient()` refetches each stale query on focus and retries three times any query
 * that sets no `retry` of its own (docs/ui-next/optimisations.md RTM-14, MNR-D8).
 *
 * It sets nothing else: the hooks keep their own `retry: false` and `gcTime: 0` (RTM-09), per query and not as a default.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
}
