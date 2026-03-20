import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { parseAppError, showAppError } from '../../errors/parseAppError';
import { SessionOptions } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';
import { CreateSession } from '../../bindings/github.com/omniviewdev/omniview/execcontrollerservice';
import { useBottomDrawer } from '../drawer';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceMutationsOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

};

type CreateSessionOptions = {
  connectionID: string;
  icon?: string | React.ReactNode;
  label?: string;
  opts: Partial<SessionOptions>
}

/**
 * Create or manage sessions from throughout the app
 */
export const useExec = ({ pluginID: explicitPluginID }: UseResourceMutationsOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
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

      const sessionOpts = SessionOptions.createFrom({
        command: ['/bin/bash'],
        tty: true,
        ...opts,
      });

      try {
        const session = await CreateSession(pluginID, connectionID, sessionOpts);
        if (!session) throw new Error('Failed to create session: null response');
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
