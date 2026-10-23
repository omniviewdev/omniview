import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Events } from '@wailsio/runtime';
import { useSnackbar, createErrorHandler } from '@omniviewdev/runtime';

// Underlying client
import { SettingsProvider } from '@omniviewdev/runtime/api';

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

  useEffect(() => Events.On('settings/changed', (event) => {
    if (event.data === category) {
      void queryClient.invalidateQueries({ queryKey: ['settings', category] });
    }
  }), [category, queryClient]);

  const settings = useQuery({
    queryKey,
    queryFn: async () => SettingsProvider.GetCategory(category),
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SettingsProvider.SetSettings(newSettings),
    onSuccess(_, _vars) {
      showSnackbar('Settings saved', 'success');

      // TODO - invalidate each one individually
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.refetchQueries({ queryKey: ['settings'] });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to save settings'),
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
