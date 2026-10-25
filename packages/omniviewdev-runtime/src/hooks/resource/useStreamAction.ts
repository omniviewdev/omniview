import React from 'react';
import { Events, type CancellablePromise } from '@wailsio/runtime';
import { useSnackbar } from '../snackbar/useSnackbar';
import { isCancelledError, parseAppError, showAppError } from '../../errors/parseAppError';
import { useOperations } from '../operations/useOperations';
import { ActionInput } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import type { ActionSnapshot } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/models';
import { StreamAction, AttachStreamAction, CancelStreamAction } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseStreamActionOptions = { pluginID?: string; connectionID: string; resourceKey: string };
type StartStreamActionParams = { actionID: string; id: string; namespace: string; label: string; params?: Record<string, unknown> };
type PendingAction = {
  disposed: boolean;
  terminal: boolean;
  handle?: string;
  sequence: number;
  unsubscribe?: () => void;
  open?: CancellablePromise<string>;
  attach?: CancellablePromise<ActionSnapshot>;
};

/** Host-ready open, listener-first attachment and owning cleanup of current actions. */
export const useStreamAction = ({ pluginID: explicitPluginID, connectionID, resourceKey }: UseStreamActionOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const { showSnackbar } = useSnackbar();
  const { addOperation, updateOperation } = useOperations();
  const actions = React.useRef(new Set<PendingAction>());

  const dispose = React.useCallback((action: PendingAction, cancelled = false) => {
    if (action.disposed) return;
    action.disposed = true;
    action.unsubscribe?.();
    void action.open?.cancel();
    void action.attach?.cancel();
    if (action.handle) {
      void CancelStreamAction(action.handle).catch(() => undefined);
      if (cancelled) updateOperation(action.handle, { status: 'cancelled', message: 'Cancelled', completedAt: Date.now() });
    }
    actions.current.delete(action);
  }, [updateOperation]);

  React.useEffect(() => () => {
    for (const action of actions.current) dispose(action, true);
  }, [pluginID, connectionID, resourceKey, dispose]);

  const startStreamAction = React.useCallback(async ({ actionID, id, namespace, label, params = {} }: StartStreamActionParams) => {
    const action: PendingAction = { disposed: false, terminal: false, sequence: 0 };
    actions.current.add(action);
    try {
      action.open = StreamAction(pluginID, connectionID, resourceKey, actionID, ActionInput.createFrom({ id, namespace, params }));
      const handle = await action.open;
      action.open = undefined;
      if (action.disposed) { void CancelStreamAction(handle).catch(() => undefined); return handle; }
      action.handle = handle;
      addOperation({ id: handle, label, resourceKey, resourceName: id, namespace, connectionID, status: 'running', startedAt: Date.now() });
      const apply = (snapshot: ActionSnapshot) => {
        if (action.disposed || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence <= action.sequence) return;
        action.sequence = snapshot.sequence;
        const event = snapshot.event;
        const data = event.data ?? {};
        if (event.type === 'error') {
          action.terminal = true;
          const error = parseAppError(event.error);
          updateOperation(handle, { status: isCancelledError(error) ? 'cancelled' : 'error', message: error.title, completedAt: Date.now() });
          showAppError(showSnackbar, error, label);
          dispose(action);
        } else if (event.type === 'complete') {
          action.terminal = true;
          const message = typeof data.message === 'string' ? data.message : `${label} completed`;
          updateOperation(handle, { status: 'completed', message, completedAt: Date.now() });
          showSnackbar(message, 'success');
          dispose(action);
        } else {
          updateOperation(handle, {
            message: typeof data.message === 'string' ? data.message : undefined,
            progress: typeof data.ready === 'number' && typeof data.desired === 'number' ? { ready: data.ready, desired: data.desired } : undefined,
          });
        }
      };
      // The host buffers latest/terminal state and emits nothing until Attach.
      action.unsubscribe = Events.On(`action/stream/${handle}`, (event) => apply(event.data as ActionSnapshot));
      action.attach = AttachStreamAction(handle);
      const snapshot = await action.attach;
      action.attach = undefined;
      apply(snapshot);
      return handle;
    } catch (error: unknown) {
      // A live terminal event may cancel the pending attachment promise during cleanup.
      if (action.terminal && action.handle) return action.handle;
      if (!action.disposed) {
        if (action.handle) updateOperation(action.handle, { status: isCancelledError(error) ? 'cancelled' : 'error', message: parseAppError(error).title, completedAt: Date.now() });
        showAppError(showSnackbar, error, `Failed to start "${actionID}"`);
      }
      dispose(action);
      throw error;
    }
  }, [pluginID, connectionID, resourceKey, addOperation, updateOperation, showSnackbar, dispose]);

  const cancelStreamAction = React.useCallback((handle: string) => {
    for (const action of actions.current) if (action.handle === handle) { dispose(action, true); return; }
  }, [dispose]);

  return { startStreamAction, cancelStreamAction };
};
