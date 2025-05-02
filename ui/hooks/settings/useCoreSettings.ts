import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@omniviewdev/runtime';

// Underlying client
import { SettingsProvider } from '@omniviewdev/runtime/api';
import { type settings } from '@omniviewdev/runtime/models';

/**
 * Interact with the global settings provider. Intended for use in the settings UI. If you need to read or write settings
 * from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useSettingsProvider = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['settings'];

  const { mutateAsync: reload } = useMutation({
    mutationFn: async () => SettingsProvider.LoadSettings(),
    onSuccess() {
      showSnackbar('Settings reloaded', 'success');
      queryClient.invalidateQueries({ queryKey });
      queryClient.refetchQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to reload settings: ${error}`, 'error');
    },
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SettingsProvider.SetSettings(newSettings),
    onSuccess(_, _vars) {
      showSnackbar('Settings saved', 'success');
      // TODO - invalidate each one individually
      queryClient.invalidateQueries({ queryKey });
      queryClient.refetchQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to save settings: ${error}`, 'error');
    },
  });

  const settings = useQuery({
    queryKey,
    queryFn: async () => SettingsProvider.ListSettings() as Promise<Record<string, settings.Category>>,
  });

  return {
    /**
     * The current settings from the provider.
     */
    settings,

    /**
     * Set multiple settings at once.
     * @param newSettings The new settings to save, as a key-value object.
     */
    setSettings,

    /**
     * Force a reload of the settings from the underlying provider.
     */
    reload,
  };
};
