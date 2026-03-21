import React from 'react';
import { useSnackbar } from '../snackbar/useSnackbar';
import { showAppError } from '../../errors/parseAppError';
import { useOperations } from '../operations/useOperations';
import { ActionInput } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import { StreamAction } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { Events } from '@wailsio/runtime';
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
          ActionInput.createFrom({ id, namespace, params }),
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
        const cancel = Events.On(eventKey, (ev) => {
          const event = ev.data as ActionEvent;
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
              Events.Off(eventKey);
              break;
            case 'error':
              updateOperation(operationID, {
                status: 'error',
                message: (event.data?.message as string) ?? 'Failed',
                completedAt: Date.now(),
              });
              showSnackbar((event.data?.message as string) ?? label + ' failed', 'error');
              Events.Off(eventKey);
              break;
          }
        });

        cleanupRef.current.push(() => {
          cancel();
          Events.Off(eventKey);
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
