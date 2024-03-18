import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "@/providers/SnackbarProvider";

// underlying client
import { ListSettings, LoadSettings, SetSettings } from "@api/settings/provider";
import { settings } from "@api/models";

/**
 * Interact with the global settings provider. Intended for use in the settings UI. If you need to read or write settings
 * from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useSettingsProvider = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['settings']

  const { mutateAsync: reload } = useMutation({
    mutationFn: () => LoadSettings(),
    onSuccess: () => {
      showSnackbar(`Settings reloaded`, 'success');
      queryClient.invalidateQueries({ queryKey });
      queryClient.refetchQueries({ queryKey });
    },
    onError: (error) => {
      showSnackbar(`Failed to reload settings: ${error}`, 'error');
    },
  });

  const { mutateAsync: setSettings } = useMutation({
    mutationFn: (newSettings: Record<string, any>) => SetSettings(newSettings),
    onSuccess: (_, _vars) => {
      showSnackbar(`Settings saved`, 'success');
      // TODO - invalidate each one individually
      queryClient.invalidateQueries({ queryKey });
      queryClient.refetchQueries({ queryKey });
    },
    onError: (error) => {
      showSnackbar(`Failed to save settings: ${error}`, 'error');
    },
  });

  const settings = useQuery({
    queryKey,
    queryFn: () => ListSettings() as Promise<{ [key: string]: settings.Category }>,
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
  }
}
