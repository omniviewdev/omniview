import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@/providers/SnackbarProvider';

// Underlying client
import { GetCategory, SetSettings } from '@api/settings/provider';

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

  const settings = useQuery({
    queryKey,
    queryFn: async () => GetCategory(category),
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => SetSettings(newSettings),
    onSuccess(_, _vars) {
      showSnackbar('Settings saved', 'success');

      // TODO - invalidate each one individually
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.refetchQueries({ queryKey: ['settings'] });
    },
    onError(error) {
      showSnackbar(`Failed to save settings: ${error}`, 'error');
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
