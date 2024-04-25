import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@/providers/SnackbarProvider';

// Underlying client
import { ListSettings, SetSettings } from '@api/settings/Client';
import { type settings } from '@api/models';

type PluginSettingsOptions = {
  /**
  * The plugin ID to get settings for.
  * @example 'radarr'
  */
  plugin: string;
};

/**
 * Get and retreive settings from a plugin's settings provider.
 */
export const usePluginSettings = ({ plugin }: PluginSettingsOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['settings', plugin];

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SetSettings(plugin, newSettings),
    onSuccess: async (_, _vars) => {
      showSnackbar('Settings saved', 'success');
      // TODO - invalidate each one individually
      await queryClient.invalidateQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to save ${plugin} plugin settings: ${error.toString()}`, 'error');
    },
  });

  const settings = useQuery({
    queryKey,
    queryFn: async () => ListSettings(plugin) as Promise<Record<string, settings.Setting>>,
  });

  return {
    /**
     * The current settings from the plugin's settings provider.
     */
    settings,

    /**
     * Set multiple settings at once.
     * @param newSettings The new settings to save, as a key-value object.
     */
    setSettings,
  };
};
