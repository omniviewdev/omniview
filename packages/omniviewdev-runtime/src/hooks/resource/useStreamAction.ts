import React from 'react';
import { useSnackbar } from '../snackbar/useSnackbar';
import { showAppError } from '../../errors/parseAppError';
import { useOperations } from '../operations/useOperations';
import { types } from '../../wailsjs/go/models';
import { StreamAction } from '../../wailsjs/go/resource/Client';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseStreamActionOptions = {
  pluginID?: string;
  connectionID: string;
  resourceKey: string;
};

type StartStreamActionParams = {
  actionID: string;
  id: string;
  namespace: string;
  label: string;
  params?: Record<string, unknown>;
};

type ActionEvent = {
  type: 'progress' | 'complete' | 'error';
  data: Record<string, unknown>;
};

/**
 * useStreamAction provides a function to start a streaming action,
 * automatically subscribing to Wails events and tracking the operation
 * in the OperationsContext.
 */
export const useStreamAction = ({
  pluginID: explicitPluginID,
  connectionID,
  resourceKey,
}: UseStreamActionOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const { showSnackbar } = useSnackbar();
  const { addOperation, updateOperation } = useOperations();
  const cleanupRef = React.useRef<(() => void)[]>([]);

  // Cleanup all listeners on unmount.
  React.useEffect(() => {
    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  const startStreamAction = React.useCallback(
    async ({ actionID, id, namespace, label, params = {} }: StartStreamActionParams) => {
      try {
        const operationID = await StreamAction(
          pluginID,
          connectionID,
          resourceKey,
          actionID,
          types.ActionInput.createFrom({ id, namespace, params }),
        );

        addOperation({
          id: operationID,
          label,
          resourceKey,
          resourceName: id,
          namespace,
          connectionID,
          status: 'running',
          startedAt: Date.now(),
        });

        const eventKey = `action/stream/${operationID}`;
        const cancel = EventsOn(eventKey, (event: ActionEvent) => {
          switch (event.type) {
            case 'progress': {
              const data = event.data ?? {};
              updateOperation(operationID, {
                message: data.message as string | undefined,
                progress:
                  data.ready !== undefined && data.desired !== undefined
                    ? { ready: data.ready as number, desired: data.desired as number }
                    : undefined,
              });
              break;
            }
            case 'complete':
              updateOperation(operationID, {
                status: 'completed',
                message: (event.data?.message as string) ?? 'Completed',
                completedAt: Date.now(),
              });
              showSnackbar((event.data?.message as string) ?? label + ' completed', 'success');
              EventsOff(eventKey);
              break;
            case 'error':
              updateOperation(operationID, {
                status: 'error',
                message: (event.data?.message as string) ?? 'Failed',
                completedAt: Date.now(),
              });
              showSnackbar((event.data?.message as string) ?? label + ' failed', 'error');
              EventsOff(eventKey);
              break;
          }
        });

        cleanupRef.current.push(() => {
          cancel();
          EventsOff(eventKey);
        });

        return operationID;
      } catch (error: unknown) {
        showAppError(showSnackbar, error, `Failed to start "${actionID}"`);
        throw error;
      }
    },
    [pluginID, connectionID, resourceKey, addOperation, updateOperation, showSnackbar],
  );

  return { startStreamAction };
};
