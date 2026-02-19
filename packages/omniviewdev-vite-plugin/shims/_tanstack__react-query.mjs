// Auto-generated shim for '@tanstack/react-query'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@tanstack/react-query'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@tanstack/react-query" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CancelledError = mod.CancelledError;
export const HydrationBoundary = mod.HydrationBoundary;
export const InfiniteQueryObserver = mod.InfiniteQueryObserver;
export const IsRestoringProvider = mod.IsRestoringProvider;
export const Mutation = mod.Mutation;
export const MutationCache = mod.MutationCache;
export const MutationObserver = mod.MutationObserver;
export const QueriesObserver = mod.QueriesObserver;
export const Query = mod.Query;
export const QueryCache = mod.QueryCache;
export const QueryClient = mod.QueryClient;
export const QueryClientContext = mod.QueryClientContext;
export const QueryClientProvider = mod.QueryClientProvider;
export const QueryErrorResetBoundary = mod.QueryErrorResetBoundary;
export const QueryObserver = mod.QueryObserver;
export const dataTagErrorSymbol = mod.dataTagErrorSymbol;
export const dataTagSymbol = mod.dataTagSymbol;
export const defaultScheduler = mod.defaultScheduler;
export const defaultShouldDehydrateMutation = mod.defaultShouldDehydrateMutation;
export const defaultShouldDehydrateQuery = mod.defaultShouldDehydrateQuery;
export const dehydrate = mod.dehydrate;
export const experimental_streamedQuery = mod.experimental_streamedQuery;
export const focusManager = mod.focusManager;
export const hashKey = mod.hashKey;
export const hydrate = mod.hydrate;
export const infiniteQueryOptions = mod.infiniteQueryOptions;
export const isCancelledError = mod.isCancelledError;
export const isServer = mod.isServer;
export const keepPreviousData = mod.keepPreviousData;
export const matchMutation = mod.matchMutation;
export const matchQuery = mod.matchQuery;
export const noop = mod.noop;
export const notifyManager = mod.notifyManager;
export const onlineManager = mod.onlineManager;
export const queryOptions = mod.queryOptions;
export const replaceEqualDeep = mod.replaceEqualDeep;
export const shouldThrowError = mod.shouldThrowError;
export const skipToken = mod.skipToken;
export const unsetMarker = mod.unsetMarker;
export const useInfiniteQuery = mod.useInfiniteQuery;
export const useIsFetching = mod.useIsFetching;
export const useIsMutating = mod.useIsMutating;
export const useIsRestoring = mod.useIsRestoring;
export const useMutation = mod.useMutation;
export const useMutationState = mod.useMutationState;
export const usePrefetchInfiniteQuery = mod.usePrefetchInfiniteQuery;
export const usePrefetchQuery = mod.usePrefetchQuery;
export const useQueries = mod.useQueries;
export const useQuery = mod.useQuery;
export const useQueryClient = mod.useQueryClient;
export const useQueryErrorResetBoundary = mod.useQueryErrorResetBoundary;
export const useSuspenseInfiniteQuery = mod.useSuspenseInfiniteQuery;
export const useSuspenseQueries = mod.useSuspenseQueries;
export const useSuspenseQuery = mod.useSuspenseQuery;

export default mod.default !== undefined ? mod.default : mod;
