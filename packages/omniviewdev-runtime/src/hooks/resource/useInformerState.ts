import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { produce } from 'immer';

import { GetInformerState } from '../../wailsjs/go/resource/Client';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import type {
  InformerConnectionSummary,
  InformerStateEvent,
} from '../../types/informer';
import { InformerResourceState } from '../../types/informer';

type UseInformerStateOptions = {
  pluginID: string;
  connectionID: string;
  enabled?: boolean;
};

/**
 * useInformerState provides real-time informer state for a connection.
 * It fetches the initial summary via Wails binding and subscribes to
 * state change events for live updates.
 */
export const useInformerState = ({
  pluginID,
  connectionID,
  enabled = true,
}: UseInformerStateOptions) => {
  const queryClient = useQueryClient();
  const queryKey = [pluginID, connectionID, 'informer-state'];

  const summaryQuery = useQuery<InformerConnectionSummary>({
    queryKey,
    queryFn: () => GetInformerState(pluginID, connectionID),
    enabled: enabled && !!pluginID && !!connectionID,
  });

  useEffect(() => {
    if (!enabled || !pluginID || !connectionID) {
      return;
    }

    const cancel = EventsOn(
      `${pluginID}/${connectionID}/informer/STATE`,
      (event: InformerStateEvent) => {
        queryClient.setQueryData<InformerConnectionSummary>(queryKey, (old) => {
          if (!old) {
            return old;
          }
          return produce(old, (draft) => {
            draft.resources[event.resourceKey] = event.state;
            draft.resourceCounts[event.resourceKey] = event.resourceCount;

            // Recompute aggregates
            let synced = 0;
            let errors = 0;
            for (const state of Object.values(draft.resources)) {
              if (state === InformerResourceState.Synced) synced++;
              if (state === InformerResourceState.Error) errors++;
            }
            draft.syncedCount = synced;
            draft.errorCount = errors;
          });
        });
      },
    );

    return cancel;
  }, [pluginID, connectionID, enabled]);

  const data = summaryQuery.data;

  // Count terminal states (synced, errored, cancelled) for progress
  let terminalCount = 0;
  if (data?.resources) {
    for (const state of Object.values(data.resources)) {
      if (
        state === InformerResourceState.Synced ||
        state === InformerResourceState.Error ||
        state === InformerResourceState.Cancelled
      ) {
        terminalCount++;
      }
    }
  }

  return {
    /** Full summary query result */
    summary: summaryQuery,

    /** Get the state of a specific resource type's informer */
    getResourceState: (key: string): InformerResourceState | undefined =>
      data?.resources[key],

    /** Whether all registered informers have reached a terminal state */
    isFullySynced: data
      ? data.totalResources > 0 && terminalCount === data.totalResources
      : false,

    /** Sync progress as a 0-1 fraction (terminal states / total) */
    syncProgress: data && data.totalResources > 0
      ? terminalCount / data.totalResources
      : 0,

    /** Number of informers that encountered errors */
    errorCount: data?.errorCount ?? 0,
  };
};
