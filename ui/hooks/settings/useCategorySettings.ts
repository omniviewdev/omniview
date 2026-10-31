import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar, createErrorHandler } from '@omniviewdev/runtime';

// Underlying client
import { SettingsProvider } from '@omniviewdev/runtime/api';
import { useSettingsChanges } from './useHostSettingsState';
import { COMMITTED_SETTINGS_MESSAGE, isCommittedSettingsError } from './settingsSaveError';

type UseCategorySettingsOptions = {
  /**
   * The ID of the category responsible for this resource
   * @example "appearance"
   */
  category: string;
};

/**
 * Interact with a category of settings from the global settings provider. Intended for use in the settings UI - if
 * you need to read or write settings from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useCategorySettings = ({ category }: UseCategorySettingsOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['settings', category];

  useSettingsChanges();

  const settings = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      return SettingsProvider.GetCategory(category);
    },
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SettingsProvider.SetSettings(newSettings),
    async onSuccess(_, _vars) {
      showSnackbar('Settings saved', 'success');

      await queryClient.cancelQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    async onError(error) {
      if (isCommittedSettingsError(error)) {
        showSnackbar(COMMITTED_SETTINGS_MESSAGE, 'error');
        await queryClient.cancelQueries({ queryKey: ['settings'] });
        await queryClient.invalidateQueries({ queryKey: ['settings'] });
      } else {
        createErrorHandler(showSnackbar, 'Failed to save settings')(error);
      }
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
  };
};
