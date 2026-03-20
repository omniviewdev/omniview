import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar, createErrorHandler, parseAppError, actionToSnackbar } from '@omniviewdev/runtime';
import { PluginManager } from '@omniviewdev/runtime/api';
import React from 'react';
import { Events } from '@omniviewdev/runtime/runtime';
import { type config, type types } from '@omniviewdev/runtime/models';

import { usePluginService } from '@/features/plugins';

enum Entity {
  PLUGINS = 'plugins',
}

/**
 * Interact with the plugin manager to get, list, install, uninstall, and update plugins.
 */
export const usePluginManager = () => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const { load } = usePluginService();

  // Listen for backend init_complete to immediately refresh the plugin list
  // instead of waiting for the 2s poll interval.
  React.useEffect(() => {
    const cleanup = Events.On('plugin/init_complete', () => {
      console.debug('[usePluginManager] plugin/init_complete received');
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
    });
    return () => cleanup();
  }, [queryClient]);

  // === Watchers === //
  React.useEffect(() => {
    // Set up watchers for plugin reload and install events
    const closer1 = Events.On('plugin/dev_reload_start', (ev) => {
      const meta = ev.data as config.PluginMeta;
      queryClient.setQueryData([Entity.PLUGINS], (oldData: types.PluginInfo[] | undefined) =>
        oldData?.map(plugin =>
          plugin.id === meta.id ? { ...plugin, phase: 'Starting', lastError: '' } : plugin,
        ),
      );

      queryClient.setQueryData([Entity.PLUGINS, meta.id], (oldData: types.PluginInfo | undefined) =>
        oldData ? { ...oldData, phase: 'Starting', lastError: '' } : oldData,
      );
    });
    const closer2 = Events.On('plugin/dev_reload_error', (ev) => {
      const [meta, error] = ev.data as [config.PluginMeta, string];
      queryClient.setQueryData([Entity.PLUGINS], (oldData: types.PluginInfo[] | undefined) =>
        oldData?.map(plugin =>
          plugin.id === meta.id ? { ...plugin, phase: 'Failed', lastError: error } : plugin,
        ),
      );

      queryClient.setQueryData([Entity.PLUGINS, meta.id], (oldData: types.PluginInfo | undefined) =>
        oldData ? { ...oldData, phase: 'Failed', lastError: error } : oldData,
      );

      const appErr = parseAppError(error);
      showSnackbar({
        message: `Failed to reload plugin '${meta.name}'`,
        status: 'error',
        details: appErr.detail,
        actions: appErr.actions?.map(actionToSnackbar),
      });
    });

    // dev_reload_complete is handled by PluginService internally — no manual wiring needed

    return () => {
      closer1()
      closer2()
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs from hooks; single-run effect
  }, []);

  // === Mutations === //

  /**
   * Prompt the user to install a plugin from a path
   */
  const installFromPath = useMutation({
    mutationFn: PluginManager.InstallFromPathPrompt,
    onSuccess(data) {
      showSnackbar({
        message: `${data.name} plugin successfully installed`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      void load(data.id);
    },
    onError: createErrorHandler(showSnackbar, 'Plugin installation failed'),
  });

  /**
   * Prompt for installing a plugin in development mode
   */
  const installDev = useMutation({
    mutationFn: PluginManager.InstallInDevMode,
    onSuccess(data) {
      showSnackbar({
        message: `${data.name} plugin successfully installed in development mode`,
        status: 'success',
        details: 'This plugin will be reloaded automatically when the source files change.',
      });

      // Don't call load() here — dev plugins need the Vite dev server to be
      // ready first. The PluginServiceProvider defers dev plugin loading
      // until the dev server is available.
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
    },
    onError: createErrorHandler(showSnackbar, 'Dev mode installation failed'),
  });

  /**
   * Reload a plugin by ID
   */
  const { mutateAsync: reloadPlugin } = useMutation({
    mutationFn: PluginManager.ReloadPlugin,
    onSuccess({ metadata }) {
      showSnackbar({
        message: `${metadata.name} plugin reloaded`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS] });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to reload plugin'),
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
    // In dev mode the frontend may load before the backend finishes
    // initializing plugins. Poll every 2s until we get a non-empty list.
    refetchInterval: (query) => {
      return query.state.data?.length === 0 ? 2000 : false;
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
    },
    retry: 1,
    retryDelay: 3000,
  })

  return {
    plugins,
    available,
    installFromPath,
    installDev,
    reloadPlugin,
  };
};

export const usePlugin = ({ id }: { id: string }) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const { reload: serviceReload, unload: serviceUnload } = usePluginService();

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

  const readme = useQuery({
    queryKey: [Entity.PLUGINS, id, 'readme'],
    queryFn: () => PluginManager.GetPluginReadme(id),
    enabled: !!id,
  });

  const reviews = useQuery({
    queryKey: [Entity.PLUGINS, id, 'reviews'],
    queryFn: () => PluginManager.GetPluginReviews(id, 1),
    enabled: !!id,
  });

  const downloadStats = useQuery({
    queryKey: [Entity.PLUGINS, id, 'download-stats'],
    queryFn: () => PluginManager.GetPluginDownloadStats(id),
    enabled: !!id,
  });

  const releaseHistory = useQuery({
    queryKey: [Entity.PLUGINS, id, 'release-history'],
    queryFn: () => PluginManager.GetPluginReleaseHistory(id),
    enabled: !!id,
  });

  /**
   * Reload the plugin
   */
  const { mutateAsync: reload } = useMutation({
    mutationFn: async () => PluginManager.ReloadPlugin(id),
    onSuccess({ id, metadata }) {
      showSnackbar({
        message: `Plugin '${metadata.name}' successfully reloaded`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      void serviceReload(metadata.id);
    },
    onError: createErrorHandler(showSnackbar, 'Failed to reload plugin'),
  });

  /**
   * Uninstall the plugin. Note that this doesn't do any confirmation or prompt the user
   * so whatever is calling this should handle that.
   */
  const { mutateAsync: uninstall } = useMutation({
    mutationFn: async () => PluginManager.UninstallPlugin(id),
    onSuccess({ id, metadata }) {
      showSnackbar({
        message: `Plugin '${metadata.name}' successfully uninstalled`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, 'registry'] });
      void serviceUnload(metadata.id);
    },
    onError: createErrorHandler(showSnackbar, 'Failed to uninstall plugin'),
  });

  /**
   * Update the plugin to a specified version
   */
  const { mutateAsync: update } = useMutation({
    mutationFn: async (version: string) => {
      const resp = await PluginManager.InstallPluginVersion(id, version)
      return resp
    },
    onSuccess(meta) {
      showSnackbar({
        message: `Plugin '${meta.name}' updated to v${meta.version}`,
        status: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: [Entity.PLUGINS, id] });
      void queryClient.refetchQueries({ queryKey: [Entity.PLUGINS] });
      void serviceReload(meta.id);
    },
    onError: createErrorHandler(showSnackbar, 'Plugin update failed'),
  });

  return {
    plugin,
    versions,
    readme,
    reviews,
    downloadStats,
    releaseHistory,
    reload,
    uninstall,
    update,
  };
};
