import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar, createErrorHandler } from '@omniviewdev/runtime';

// Underlying client
import { SettingsProvider } from '@omniviewdev/runtime/api';
import type { Category } from '@omniviewdev/runtime/models';
import { useSettingsChanges } from './useHostSettingsState';
import { COMMITTED_SETTINGS_MESSAGE, isCommittedSettingsError } from './settingsSaveError';

/**
 * Interact with the global settings provider. Intended for use in the settings UI. If you need to read or write settings
 * from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useSettingsProvider = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  useSettingsChanges();

  const queryKey = ['settings'];

  const { mutateAsync: reload } = useMutation({
    mutationFn: async () => SettingsProvider.LoadSettings(),
    async onSuccess() {
      showSnackbar('Settings reloaded', 'success');
      await queryClient.cancelQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to reload settings'),
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SettingsProvider.SetSettings(newSettings),
    async onSuccess(_, _vars) {
      showSnackbar('Settings saved', 'success');
      await queryClient.cancelQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey });
    },
    async onError(error) {
      if (isCommittedSettingsError(error)) {
        showSnackbar(COMMITTED_SETTINGS_MESSAGE, 'error');
        await queryClient.cancelQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey });
      } else {
        createErrorHandler(showSnackbar, 'Failed to save settings')(error);
      }
    },
  });

  const settings = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      return SettingsProvider.ListSettings() as Promise<Record<string, Category>>;
    },
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
