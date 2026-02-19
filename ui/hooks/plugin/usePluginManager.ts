import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@omniviewdev/runtime';
import { PluginManager } from '@omniviewdev/runtime/api';
import React from 'react';
import { EventsEmit, EventsOn } from '@omniviewdev/runtime/runtime';
import { type config } from '@omniviewdev/runtime/models';

import { clearPlugin, importPlugin, loadAndRegisterPlugin } from '@/features/plugins/api/loader';

enum Entity {
  PLUGINS = 'plugins',
}

/**
 * Interact with the plugin manager to get, list, install, uninstall, and update plugins.
 */
export const usePluginManager = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  // === Watchers === //
  React.useEffect(() => {
    // Set up watchers for plugin reload and install events
    const closer1 = EventsOn('plugin/dev_reload_start', (meta: config.PluginMeta) => {
      // Find the plugin in the list of plugins and update the status
      // to show that it's reloading
      queryClient.setQueryData([Entity.PLUGINS], (oldData: config.PluginMeta[]) => oldData.map(plugin => {
        if (plugin.id === meta.id) {
          return {
            ...plugin,
            loading: true,
            loadError: '',
          };
        }

        return plugin;
      }));

      queryClient.setQueryData([Entity.PLUGINS, meta.id], (oldData: config.PluginMeta) => ({
        ...oldData,
        loading: true,
        loadError: '',
      }));

      // showSnackbar({
      //   message: `Reloading plugin '${meta.name}'`,
      //   status: 'info',
      // });
    });
    const closer2 = EventsOn('plugin/dev_reload_rror', (meta: config.PluginMeta, error: string) => {
      // Find the plugin in the list of plugins and update the status
      // to show that it's reloading
      queryClient.setQueryData([Entity.PLUGINS], (oldData: config.PluginMeta[]) => oldData.map(plugin => {
        if (plugin.id === meta.id) {
          return {
            ...plugin,
            loading: false,
            loadError: error,
          };
        }

        return plugin;
      }));

      queryClient.setQueryData([Entity.PLUGINS, meta.id], (oldData: config.PluginMeta) => ({
        ...oldData,
        loading: false,
        loadError: error,
      }));

      showSnackbar({
        message: `Failed to reload plugin '${meta.name}'`,
        status: 'error',
        details: error,
      });
    });
    const closer3 = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      // Find the plugin in the list of plugins and update the status
      // to show that it's reloading
      queryClient.setQueryData([Entity.PLUGINS], (oldData: config.PluginMeta[]) => oldData.map(plugin => {
        if (plugin.id === meta.id) {
          return {
            ...plugin,
            loading: false,
            loadError: '',
          };
        }

        return plugin;
      }));

      queryClient.setQueryData([Entity.PLUGINS, meta.id], (oldData: config.PluginMeta) => ({
        ...oldData,
        loading: false,
        loadError: '',
      }));

      // Trigger a reload of the plugin ui
      clearPlugin({ pluginId: meta.id })

      // showSnackbar({
      //   message: `Plugin '${meta.name}' reloaded`,
      //   status: 'success',
      // });
    });

    // const closer4 = EventsOn('plugin/dev_install_start', (meta: config.PluginMeta) => {
    //   showSnackbar({
    //     message: `Installing plugin '${meta.name}' in development mode`,
    //     status: 'info',
    //   });
    // });

    return () => {
      // Cleanup watchers
      closer1()
      closer2()
      closer3()
      // closer4()
    };
  }, []);

  // === Mutations === //

  /**
   * Prompt the user to install a plugin from a path
   */
  const { mutateAsync: promptInstallFromPath } = useMutation({
    mutationFn: PluginManager.InstallFromPathPrompt,
    onSuccess(data) {
      showSnackbar(`${data.name} plugin successfully installed`, 'success');
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      loadAndRegisterPlugin(data.id);
      EventsEmit('plugin/install_complete', data)
    },
    onError(error) {
      if (`${error.message}` === 'cancelled' || `${error.message}` === 'undefined') {
        // User cancelled the prompt, nothing actually wrong
        return;
      }

      showSnackbar(`Plugin installation failed: ${error.name}`, 'error');
    },
  });

  /**
   * Prompt for installing a plugin in development mode
   */
  const { mutateAsync: promptInstallDev } = useMutation({
    mutationFn: PluginManager.InstallInDevMode,
    onSuccess(data) {
      showSnackbar({
        message: `${data.name} plugin successfully installed in development mode`,
        status: 'success',
        details: 'This plugin will be reloaded automatically when the source files change.',
      });
      loadAndRegisterPlugin(data.id);

      EventsEmit('plugin/install_complete', data)
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
    },
    onError(error) {
      if (`${error.message}` === 'cancelled' || `${error.message}` === 'undefined') {
        // User cancelled the prompt, nothing actually wrong
        return;
      }

      showSnackbar(`Plugin installation failed: ${error.message}`, 'error');
    },
  });

  /**
   * Reload a plugin by ID
   */
  const { mutateAsync: reloadPlugin } = useMutation({
    mutationFn: PluginManager.ReloadPlugin,
    onSuccess({ metadata }) {
      showSnackbar(`${metadata.name} plugin reloaded`, 'success');
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
    },
    onError(error) {
      showSnackbar(`Failed to reload plugin: ${error.message}`, 'error');
    },
  });

  // === Queries === //

  const plugins = useQuery({
    queryKey: [Entity.PLUGINS],
    queryFn: async () => {
      console.debug('[usePluginManager] fetching plugin list');
      const plugins = await PluginManager.ListPlugins();
      console.debug('[usePluginManager] got plugins', { count: plugins?.length ?? 0, ids: plugins?.map(p => p.id) });
      if (!plugins) {
        return [];
      }

      return plugins;
    },
  });

  const available = useQuery({
    queryKey: [Entity.PLUGINS, 'registry'],
    queryFn: async () => {
      const available = await PluginManager.ListAvailablePlugins();
      if (!available) {
        return [];
      }

      return available
    }
  })

  return {
    plugins,
    available,
    promptInstallFromPath,
    promptInstallDev,
    reloadPlugin,
  };
};

export const usePlugin = ({ id }: { id: string }) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const plugin = useQuery({
    queryKey: [Entity.PLUGINS, id],
    async queryFn({ queryKey }) {
      const [, id] = queryKey;
      return PluginManager.GetPlugin(id);
    },
  });


  const versions = useQuery({
    queryKey: [Entity.PLUGINS, id, 'versions'],
    queryFn: async () => {
      const versions = await PluginManager.GetPluginVersions(id);
      return versions
    },
  });

  /**
   * Reload the plugin
   */
  const { mutateAsync: reload } = useMutation({
    mutationFn: async () => PluginManager.ReloadPlugin(id),
    onSuccess({ id, metadata }) {
      showSnackbar(`Plugin '${metadata.name}' sucessfully reloaded`, 'success');
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      clearPlugin({ pluginId: metadata.id })
      loadAndRegisterPlugin(metadata.id)
    },
    onError(error) {
      showSnackbar(`Failed to reload plugin: ${error.message}`, 'error');
    },
  });

  /**
   * Uninstall the plugin. Note that this doesn't do any confirmation or prompt the user
   * so whatever is calling this should handle that.
   */
  const { mutateAsync: uninstall } = useMutation({
    mutationFn: async () => PluginManager.UninstallPlugin(id),
    onSuccess({ id, metadata }) {
      showSnackbar(`Plugin '${metadata.name}' sucessfully uninstalled`, 'success');
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      clearPlugin({ pluginId: metadata.id })
    },
    onError(error) {
      showSnackbar(`Failed to uninstall plugin: ${error.message}`, 'error');
    },
  });

  /**
   * Update the plugin to a specified version
   */
  const { mutateAsync: update } = useMutation({
    mutationFn: async (version: string) => {
      console.debug(`[usePluginManager] updating plugin "${id}" to version "${version}"`, { plugin: id, version })
      const resp = await PluginManager.InstallPluginVersion(id, version)
      return resp
    },
    onSuccess(meta) {
      showSnackbar(`Plugin '${meta.name}' sucessfully updated to version '${meta.version}`, 'success');
      // Invalidate the plugins query to refetch the list of plugins
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      EventsEmit('plugin/install_complete', meta)

      loadAndRegisterPlugin(meta.id)
    },

    onError(error) {
      if (`${error.message}` === 'cancelled' || `${error.message}` === 'undefined') {
        // User cancelled the prompt, nothing actually wrong
        return;
      }

      showSnackbar(`Plugin update failed: ${error.name}`, 'error');
    },
  });

  return {
    plugin,
    versions,
    reload,
    uninstall,
    update,
  };
};
