import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './queryClient';

// The new shell's one QueryClient (docs/ui-next/optimisations.md RTM-14, MNR-D8). The old shell sets `refetchOnWindowFocus: false`
// for every query (ui/App.tsx:110-114); a bare `new QueryClient()` refetches each stale query on focus.

/** How many times a stale query is fetched once the window has lost focus and regained it. */
async function fetchesAfterFocus(client: QueryClient): Promise<number> {
  client.mount();
  let calls = 0;
  const observer = new QueryObserver(client, { queryKey: ['focus-probe'], queryFn: () => ++calls, staleTime: 0 });
  const unsubscribe = observer.subscribe(() => undefined);
  await vi.waitFor(() => {
    expect(calls).toBe(1);
  });
  // A refetch on focus starts inside this call, so `calls` has moved by the time the microtasks have run.
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await Promise.resolve();
  unsubscribe();
  client.unmount();
  return calls;
}

describe('createQueryClient', () => {
  it('turns refetch on window focus off, as the old shell does', () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('leaves the hooks\' own settings alone: no default retry, no default gcTime', () => {
    const queries = createQueryClient().getDefaultOptions().queries;

    expect(queries?.retry).toBeUndefined();
    expect(queries?.gcTime).toBeUndefined();
  });

  it('does not refetch a stale query when the window regains focus', async () => {
    expect(await fetchesAfterFocus(createQueryClient())).toBe(1);
  });

  it('is what the setting is for: a bare QueryClient does refetch on focus (the negative control)', async () => {
    expect(await fetchesAfterFocus(new QueryClient())).toBe(2);
  });
});
