import { useCallback, useContext, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Diagnostics } from '@omniviewdev/runtime/api';
import { PageVisibilityContext } from '@/features/workspace/pageVisibility';

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener); 
  };
}

function isVisible() {
  return document.visibilityState !== 'hidden';
}

export function useDiagnostics(live = true) {
  const documentVisible = useSyncExternalStore(subscribeVisibility, isVisible);
  const pageVisible = useContext(PageVisibilityContext);
  const visible = documentVisible && pageVisible && live;
  const query = useQuery({
    queryKey: ['application-diagnostics', 'live'],
    enabled: visible,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const history = await Diagnostics.GetHistory();
      signal.throwIfAborted();
      return { samples: (history.samples ?? []).slice(-300), health: history.health };
    },
  });
  const captures = useQuery({
    queryKey: ['application-diagnostics', 'capture-summaries'],
    enabled: visible,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const summaries = await Diagnostics.ListCaptures();
      signal.throwIfAborted();
      return (summaries ?? []).slice(0, 40);
    },
  });
  const catalog = useQuery({
    queryKey: ['application-diagnostics', 'catalog'],
    enabled: visible,
    staleTime: 30000,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const descriptors = await Diagnostics.GetCatalog();
      signal.throwIfAborted();
      return descriptors;
    },
  });
  const { refetch } = query;
  const { refetch: refetchCaptures } = captures;
  const { refetch: refetchCatalog } = catalog;
  const refresh = useCallback(async () => {
    if (isVisible() && pageVisible) {
      await Promise.all([refetch(), refetchCaptures(), refetchCatalog()]);
    }
  }, [refetch, refetchCaptures, refetchCatalog, pageVisible]);
  const samples = query.data?.samples ?? [];
  const error = query.error ?? captures.error ?? catalog.error;
  return {
    samples,
    health: query.data?.health,
    captures: captures.data ?? [],
    catalog: catalog.data,
    error: error ? String(error) : '',
    updating: query.isFetching || captures.isFetching || catalog.isFetching,
    refresh,
    latest: samples.at(-1),
    updatedAt: query.dataUpdatedAt,
  };
}
