import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
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
  const { createTab } = useBottomDrawer();

  const createSessionMutation = useMutation({
    mutationFn: async ({ connectionID, icon, label, opts }: CreateSessionOptions) =>
      CreateSession(pluginID, connectionID, exec.SessionOptions.createFrom({
        command: ['/bin/sh', '-c', 'stty -echo && /bin/sh'],
        tty: true,
        ...opts
      }))
        .then(session => createTab({
          id: session.id,
          title: label ?? `Session ${session.id.substring(0, 8)}`,
          variant: 'terminal',
          icon: icon ?? 'LuSquareTerminal',
        })
        ),
    onError(error: Error) {
      showSnackbar(`Failed to start session: ${error.message}`, 'error');
    },
  })

  return {
    createSession: createSessionMutation.mutateAsync,
  };
};

export default useExec;
