import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';

// Types
import { types } from '../../wailsjs/go/models';

// Underlying client
import { List, Create } from '../../wailsjs/go/resource/Client';
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime';
import { produce } from 'immer';
import get from 'lodash.get';

type AddPayload = {
  data: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

type UpdatePayload = {
  oldData: any;
  newData: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

type DeletePayload = {
  data: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

type UseResourcesOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID: string;

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
   * The dot-delimited path on which id's can be used for updates. In order for the informer
   * live functionality to work, this must be set to the path on which the ID is located.
   */
  idAccessor?: string;

  /**
   * Optional parameters to pass to the resource fetch
   * @example { labelSelector: "app=nginx" }
   */
  listParams?: Record<string, unknown>;

  /**
  * Optional parameters to pass to the resource create
  * @example { dryRun: true }
  */
  createParams?: Record<string, unknown>;
};

/**
 * The useResource hook returns a hook, scoped to the desired resource and connection, that allows for interacting
 * with, and fetching, the resource data.
 *
 * It should be noted that this hook does not perform any logic to ensure that either the resource exists,
 * @throws If the resourceID is invalid
 */
export const useResources = ({
  pluginID,
  connectionID,
  resourceKey,
  idAccessor,
  namespaces = [],
  listParams = {},
  createParams = {},
}: UseResourcesOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = [pluginID, connectionID, resourceKey, namespaces, 'list'];
  const getResourceKey = (id: string, namespace: string) => [pluginID, connectionID, resourceKey, namespace, id];

  // === Mutations === //

  const { mutateAsync: create } = useMutation({
    mutationFn: async (opts: Partial<types.CreateInput>) => Create(pluginID, connectionID, resourceKey, types.CreateInput.createFrom({
      params: opts.params as Record<string, unknown> || createParams,
      input: opts.input,
      namespaces,
    })),
    onSuccess: async (data) => {
      let foundID = '';

      // Attempt to find an ID based on some common patterns
      if (data.result.metadata?.name) {
        foundID = data.result.metadata.name as string;
      } else if (data.result?.id) {
        foundID = data.result?.id as string;
      } else if (data.result?.name) {
        foundID = data.result?.name as string;
      } else if (data.result?.ID) {
        foundID = data.result?.ID as string;
      } else if (data.result?.Name) {
        foundID = data.result.Name as string;
      }

      const message = foundID ? `Resource ${foundID} created` : 'Resource created';
      showSnackbar(message, 'success');

      await queryClient.invalidateQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to create resource: ${error.message}`, 'error');
    },
  });

  const resourceQuery = useQuery({
    queryKey,
    queryFn: async () => List(pluginID, connectionID, resourceKey, types.ListInput.createFrom({
      params: listParams,
      order: {
        by: 'name',
        direction: true,
      },
      pagination: {
        page: 1,
        pageSize: 200,
      },
      namespaces,
    })),
    retry: false,
  });


  // === Informer Cache Updates === //

  /**
   * Handle adding new resources to the resource list
   */
  const onResourceAdd = React.useCallback((newResource: AddPayload) => {
    if (!idAccessor) {
      return;
    }

    queryClient.setQueryData(queryKey, (oldData: types.ListResult) => {
      return produce(oldData, (draft) => {
        if (!draft) {
          draft = types.ListResult.createFrom({
            result: {},
            success: true,
            pagination: {},
          });
        }

        const index = draft.result.findIndex(item => get(idAccessor, newResource.data) === get(idAccessor, item));
        if (index !== -1) {
          draft.result[index] = newResource.data;
          return;
        }
      });
    });
    queryClient.setQueryData(getResourceKey(newResource.id, newResource.namespace), { result: newResource.data });
  }, []);

  /**
   * Handle updating resources in the resource list
   */
  const onResourceUpdate = React.useCallback((updateEvent: UpdatePayload) => {
    if (!idAccessor) {
      return;
    }

    queryClient.setQueryData(queryKey, (oldData: types.ListResult) => {
      return produce(oldData, (draft) => {
        if (!draft) {
          draft = types.ListResult.createFrom({
            result: {},
            success: true,
            pagination: {},
          });
        }

        const index = draft.result.findIndex(item => get(idAccessor, updateEvent.newData) === get(idAccessor, item));
        if (index !== -1) {
          draft.result[index] = updateEvent.newData;
          return;
        }
      });
    });
    queryClient.setQueryData(getResourceKey(updateEvent.id, updateEvent.namespace), { result: updateEvent.newData });
  }, []);

  /**
   * Handle deleting pods from the resource list
   */
  const onResourceDelete = React.useCallback((deletedResource: DeletePayload) => {
    if (!idAccessor) {
      return;
    }

    queryClient.setQueryData(queryKey, (oldData: types.ListResult) => {
      return produce(oldData, (draft) => {
        if (!draft) {
          return;
        }

        const index = draft.result.findIndex(item => get(idAccessor, deletedResource.data) === get(idAccessor, item));
        if (index !== -1) {
          draft.result.splice(index, 1);
          return;
        }
      });
    });
    // TODO - don't delete yet, just set to undefined
    // queryClient.setQueryData(getResourceKey(deletedResource.id, deletedResource.namespace), undefined);
  }, []);

  // *Only on mount*, we want subscribe to new resources, updates and deletes
  React.useEffect(() => {
    if (idAccessor) {
      EventsOn(`${pluginID}/${connectionID}/${resourceKey}/ADD`, onResourceAdd);
      EventsOn(`${pluginID}/${connectionID}/${resourceKey}/UPDATE`, onResourceUpdate);
      EventsOn(`${pluginID}/${connectionID}/${resourceKey}/DELETE`, onResourceDelete);
    }

    return () => {
      if (idAccessor) {
        EventsOff(`${pluginID}/${connectionID}/${resourceKey}/ADD`);
        EventsOff(`${pluginID}/${connectionID}/${resourceKey}/UPDATE`);
        EventsOff(`${pluginID}/${connectionID}/${resourceKey}/DELETE`);
      }
    };
  }, []);

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
  };
};
