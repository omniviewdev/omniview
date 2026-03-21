import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';

// Types
import { CreateInput, ListInput } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import { WatchState } from '../../types/watch';
import type { WatchStateEvent } from '../../types/watch';

// Underlying client
import { List, Create, SubscribeResource, UnsubscribeResource } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { Events } from '@wailsio/runtime';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useEventBatcher } from './useEventBatcher';
import type { AddPayload, UpdatePayload, DeletePayload } from './useEventBatcher';

type UseResourcesOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

  /**
   * The connection ID to scope the resource to
   * @example "integration"
   */
  connectionID: string;

  /**
   * The GVR (Group, Version, Resource) identifier to fetch
   * @example "core::v1::pods"
   */
  resourceKey: string;

  /**
   * Optional namespace to scope the resource to, if the backend
   * supports the concept of namespaces of resources. If the backend
   * supports the concept of namespaces, and this is not provided,
   * it will default to selecting from all namespaces.
   * @example "default"
   */
  namespaces?: string[];

  /**
   * The dot-delimited path on which id's can be used for updates. In order for the watch
   * live functionality to work, this must be set to the path on which the ID is located.
   */
  idAccessor?: string;

};

/**
 * The useResource hook returns a hook, scoped to the desired resource and connection, that allows for interacting
 * with, and fetching, the resource data.
 *
 * It should be noted that this hook does not perform any logic to ensure that either the resource exists,
 * @throws If the resourceID is invalid
 */
export const useResources = ({
  pluginID: explicitPluginID,
  connectionID,
  resourceKey,
  idAccessor,
  namespaces,
}: UseResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const stableNamespaces = React.useMemo(() => namespaces ?? [], [namespaces]);
  const queryKey = React.useMemo(
    () => [pluginID, connectionID, resourceKey, stableNamespaces, 'list'],
    [pluginID, connectionID, resourceKey, stableNamespaces],
  );
  const getResourceKey = React.useCallback(
    (id: string, namespace: string) => [pluginID, connectionID, resourceKey, namespace, id],
    [pluginID, connectionID, resourceKey],
  );

  // === Mutations === //

  const { mutateAsync: create } = useMutation({
    mutationFn: async (opts: { input?: any; namespace?: string }) => Create(pluginID, connectionID, resourceKey, CreateInput.createFrom({
      input: opts.input,
      namespace: opts.namespace ?? (stableNamespaces.length === 1 ? stableNamespaces[0] : ''),
    })),
    onSuccess: async (data) => {
      const result = data?.result as any;
      let foundID = '';

      // Attempt to find an ID based on some common patterns
      if (result?.metadata?.name) {
        foundID = result.metadata.name as string;
      } else if (result?.id) {
        foundID = result.id as string;
      } else if (result?.name) {
        foundID = result.name as string;
      } else if (result?.ID) {
        foundID = result.ID as string;
      } else if (result?.Name) {
        foundID = result.Name as string;
      }

      const message = foundID ? `Resource ${foundID} created` : 'Resource created';
      showSnackbar(message, 'success');

      await queryClient.invalidateQueries({ queryKey });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to create resource'),
  });

  const resourceQuery = useQuery({
    queryKey,
    queryFn: async () => List(pluginID, connectionID, resourceKey, ListInput.createFrom({
      order: [{ field: 'name', descending: false }],
      pagination: { page: 1, pageSize: 200 },
      namespaces: stableNamespaces,
    })),
    placeholderData: (previousData, _) => previousData,
    retry: false,
  });


  // === Watch State === //

  const [watchState, setWatchState] = React.useState<WatchState>(
    WatchState.WatchStateIdle
  );

  React.useEffect(() => {
    const cancel = Events.On(
      `${pluginID}/${connectionID}/watch/STATE`,
      (ev) => {
        const event = ev.data as WatchStateEvent;
        if (event.resourceKey === resourceKey) {
          setWatchState(event.state);
        }
      },
    );
    return cancel;
  }, [pluginID, connectionID, resourceKey]);

  // === Watch Cache Updates (adaptive batching) === //

  const enqueue = useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, watchState);

  // Subscribe to live resource events when this view mounts. The Go side only
  // forwards ADD/UPDATE/DELETE events over the Wails bridge for resources with
  // an active subscription, keeping the bridge silent during initial sync.
  React.useEffect(() => {
    if (!idAccessor) {
      return;
    }

    // Tell Go we want live events for this resource. The initial List
    // query already returns current data, and live ADD/UPDATE/DELETE
    // events are applied to the cache via useEventBatcher from this
    // point forward — no need to re-List after subscribing.
    SubscribeResource(pluginID, connectionID, resourceKey);

    const addCloser = Events.On(
      `${pluginID}/${connectionID}/${resourceKey}/ADD`,
      (ev) => enqueue({ type: 'ADD', payload: ev.data as AddPayload }),
    );
    const updateCloser = Events.On(
      `${pluginID}/${connectionID}/${resourceKey}/UPDATE`,
      (ev) => enqueue({ type: 'UPDATE', payload: ev.data as UpdatePayload }),
    );
    const deleteCloser = Events.On(
      `${pluginID}/${connectionID}/${resourceKey}/DELETE`,
      (ev) => enqueue({ type: 'DELETE', payload: ev.data as DeletePayload }),
    );

    return () => {
      addCloser();
      updateCloser();
      deleteCloser();
      // Tell Go we no longer need live events
      void UnsubscribeResource(pluginID, connectionID, resourceKey);
    };
  }, [pluginID, connectionID, resourceKey, enqueue]);

  return {
    /**
     * Fetch result for the resource. The client will automatically cache the result, and update the cache
     * when the resources are updated or deleted via the returned create and remove mutation functions, or
     * the per-resource hook mutation functions.
     */
    resources: resourceQuery,

    /**
     * Create a new resource. A set of optional parameters can be passed to customize the create behavior,
     * which if specified, will add additional default behavior set via the hook options.
     *
     * @params opts Optional parameters to pass to the resource create operation
     */
    create,

    /** Current watch state for this resource type */
    watchState,

    /** Whether the watch is currently syncing */
    isSyncing: watchState === WatchState.WatchStateSyncing,

    /** Whether the watch has fully synced */
    isSynced: watchState === WatchState.WatchStateSynced,

    /** Whether the watch encountered an error */
    watchError: watchState === WatchState.WatchStateError,
  };
};
