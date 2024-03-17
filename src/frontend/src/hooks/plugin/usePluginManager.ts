import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "@/providers/SnackbarProvider";
import { ListPlugins, InstallFromPathPrompt, ReloadPlugin, GetPlugin, UninstallPlugin } from "@api/plugin/pluginManager";

enum Entity {
  PLUGINS = "plugins",
}

/**
 * Interact with the plugin manager to get, list, install, uninstall, and update plugins.
 */
export const usePluginManager = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  // === Mutations === //

  /** 
   * Prompt the user to install a plugin from a path
   */
  const { mutateAsync: promptInstallFromPath } = useMutation({
    mutationFn: InstallFromPathPrompt,
    onSuccess: (data) => {
      showSnackbar(`${data.name} plugin sucessfully installed`, 'success')
      // Invalidate the plugins query to refetch the list of plugins
      queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] })
      queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] })
    },
    onError: (error) => {
      if (`${error}` === 'cancelled') {
        // User cancelled the prompt, nothing actually wrong
        return
      }
      showSnackbar(`Plugin installation failed: ${error}`, 'error')
    },
  });

  /**
   * Reload a plugin by ID
   */
  const { mutateAsync: reloadPlugin } = useMutation({
    mutationFn: ReloadPlugin,
    onSuccess: ({ metadata }) => {
      showSnackbar(`${metadata.name} plugin sucessfully reloaded`, 'success')
      // Invalidate the plugins query to refetch the list of plugins
      queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] })
    },
    onError: (error) => {
      showSnackbar(`Failed to reload plugin: ${error}`, 'error')
    },
  });

  // === Queries === //

  const plugins = useQuery({
    queryKey: [Entity.PLUGINS],
    queryFn: ListPlugins,
  });

  return {
    plugins,
    promptInstallFromPath,
    reloadPlugin,
  }
}

export const usePlugin = ({ id }: { id: string }) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const plugin = useQuery({
    queryKey: [Entity.PLUGINS, id],
    queryFn: ({ queryKey }) => {
      const [, id] = queryKey;
      return GetPlugin(id);
    },
  });

  /**
   * Reload the plugin
   */
  const { mutateAsync: reload } = useMutation({
    mutationFn: () => ReloadPlugin(id),
    onSuccess: ({ id, metadata }) => {
      showSnackbar(`Plugin '${metadata.name}' sucessfully reloaded`, 'success')
      // Invalidate the plugins query to refetch the list of plugins
      queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] })
      queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] })
    },
    onError: (error) => {
      showSnackbar(`Failed to reload plugin: ${error}`, 'error')
    },
  });

  /**
   * Uninstall the plugin. Note that this doesn't do any confirmation or prompt the user
   * so whatever is calling this should handle that.
   */
  const { mutateAsync: uninstall } = useMutation({
    mutationFn: () => UninstallPlugin(id),
    onSuccess: ({ id, metadata }) => {
      showSnackbar(`Plugin '${metadata.name}' sucessfully uninstalled`, 'success')
      // Invalidate the plugins query to refetch the list of plugins
      queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] })
      queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] })
    },
    onError: (error) => {
      showSnackbar(`Failed to uninstall plugin: ${error}`, 'error')
    },
  });

  return {
    plugin,
    reload,
    uninstall,
  }
}
