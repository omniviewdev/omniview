import React from 'react';
import { Events, type CancellablePromise } from '@wailsio/runtime';
import { useSnackbar } from '../snackbar/useSnackbar';
import { isCancelledError, parseAppError, showAppError } from '../../errors/parseAppError';
import { useOperations } from '../operations/useOperations';
import type { ActionRequest } from '../../resource/v2/domain';
import { valueToJSON } from '../../resource/v2/value';
import type { ActionSnapshot } from '../../resource/v2/client';
import { StreamAction, AttachStreamAction, CancelStreamAction } from '../../resource/v2/client';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { requireConnectionReady } from '../../connection/connectionReadiness';

type UseStreamActionOptions = { pluginID?: string };
type StartStreamActionParams = { request: ActionRequest; label: string };
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
export const useStreamAction = ({ pluginID: explicitPluginID }: UseStreamActionOptions) => {
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
  }, [pluginID, dispose]);

  const startStreamAction = React.useCallback(async ({ request, label }: StartStreamActionParams) => {
    const action: PendingAction = { disposed: false, terminal: false, sequence: 0 };
    actions.current.add(action);
    try {
      await requireConnectionReady(pluginID, request.route.connection);
      if (action.disposed) throw new Error('Stream action was cancelled before the connection became ready');
      action.open = StreamAction(pluginID, request);
      const handle = await action.open;
      action.open = undefined;
      if (action.disposed) { void CancelStreamAction(handle).catch(() => undefined); return handle; }
      action.handle = handle;
      addOperation({ id: handle, label, resourceKey: request.typeTarget?.type ?? request.reference?.address.type ?? '', resourceName: request.reference?.address.id ?? '', connectionID: request.route.connection, status: 'running', startedAt: Date.now() });
      const apply = (snapshot: ActionSnapshot) => {
        if (action.disposed || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence <= action.sequence) return;
        action.sequence = snapshot.sequence;
        const event = snapshot.event;
        const decoded = event.data ? valueToJSON(event.data) : undefined;
        const data = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded as Record<string, unknown> : {};
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
            progress: (typeof data.ready === 'number' || typeof data.ready === 'bigint') && (typeof data.desired === 'number' || typeof data.desired === 'bigint') ? { ready: Number(data.ready), desired: Number(data.desired) } : undefined,
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
        showAppError(showSnackbar, error, `Failed to start "${request.action}"`);
      }
      dispose(action);
      throw error;
    }
  }, [pluginID, addOperation, updateOperation, showSnackbar, dispose]);

  const cancelStreamAction = React.useCallback((handle: string) => {
    for (const action of actions.current) if (action.handle === handle) { dispose(action, true); return; }
  }, [dispose]);

  return { startStreamAction, cancelStreamAction };
};
