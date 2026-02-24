import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { parseAppError, showAppError } from '../../errors/parseAppError';
import { exec } from '../../wailsjs/go/models';
import { CreateSession } from '../../wailsjs/go/exec/Client';
import { useBottomDrawer } from '../drawer';

type UseResourceMutationsOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID: string;

};

type CreateSessionOptions = {
  connectionID: string;
  icon?: string | React.ReactNode;
  label?: string;
  opts: Partial<exec.SessionOptions>
}

/**
 * Create or manage sessions from throughout the app
 */
export const useExec = ({ pluginID }: UseResourceMutationsOptions) => {
  const { showSnackbar } = useSnackbar();
  const { createTab, updateTab } = useBottomDrawer();

  const createSessionMutation = useMutation({
    mutationFn: async ({ connectionID, icon, label, opts }: CreateSessionOptions) => {
      const tempId = `pending-${crypto.randomUUID()}`;

      // Create tab immediately with connecting status
      createTab({
        id: tempId,
        title: label ?? 'Connecting...',
        variant: 'terminal',
        icon: icon ?? 'LuSquareTerminal',
        properties: {
          status: 'connecting',
          pluginID,
          connectionID,
          opts: { ...opts },
        },
      });

      const sessionOpts = exec.SessionOptions.createFrom({
        command: ['/bin/bash'],
        tty: true,
        ...opts,
      });

      try {
        const session = await CreateSession(pluginID, connectionID, sessionOpts);
        // Replace temp ID with real session ID and mark connected
        updateTab(
          { id: tempId },
          {
            id: session.id,
            title: label ?? `Session ${session.id.substring(0, 8)}`,
            properties: { status: 'connected', pluginID, connectionID, opts: { ...opts } },
          },
        );
      } catch (error) {
        const appErr = parseAppError(error);
        // Mark tab as errored
        updateTab(
          { id: tempId },
          {
            properties: { status: 'error', error: appErr.detail, pluginID, connectionID, opts: { ...opts } },
          },
        );
        showAppError(showSnackbar, error, 'Failed to start session');
      }
    },
  })

  return {
    createSession: createSessionMutation.mutateAsync,
  };
};

export default useExec;
