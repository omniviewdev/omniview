import { Button, Heading, Spinner, Text } from '@omniviewdev/base-ui';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import { DevServerManager } from '@omniviewdev/runtime/api';
import { useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useInstalledPlugins } from '@/hooks/plugin/useInstalledPlugins';
import { devToolsChannel } from '@/features/devtools/events';
import { usePluginService } from '../react/usePluginService';
import PluginLoadErrorPage from './PluginLoadErrorPage';
import PluginNotFoundPage from './PluginNotFoundPage';
import styles from './PluginRouteStatus.module.css';

type Props = { pluginId?: string };

/** Owns plugin URLs before the plugin has registered any routes. */
export default function PluginRouteStatus({ pluginId }: Props) {
  const params = useParams<{ pluginId: string }>();
  const id = pluginId ?? params.pluginId ?? '';
  const restart = useMutation({ mutationFn: async (target: string) => DevServerManager.RestartDevServer(target) });
  const { plugins } = usePluginService();
  const { plugins: installed, isLoading, error } = useInstalledPlugins();
  const plugin = installed.find((candidate) => candidate.id === id);
  const state = plugins.get(id);

  if (state?.phase === 'error') {
    return <PluginLoadErrorPage pluginId={id} error={state.error ?? 'Plugin initialization failed'} />;
  }

  if (!isLoading && !error && !plugin && !state) {
    return <PluginNotFoundPage />;
  }

  const devFailed = plugin?.dev === true && (
    plugin.devStatus === DevProcessStatus.DevProcessStatusError
    || plugin.devStatus === DevProcessStatus.DevProcessStatusStopped
    || Boolean(plugin.devError)
  );
  const inventoryFailed = !plugin?.devPort && (
    plugin?.phase === 'Stopped'
    || plugin?.phase === 'Failed'
    || plugin?.phase === 'BuildFailed'
  );
  const inventoryError = inventoryFailed && plugin?.devStatus === undefined ? plugin?.lastError : undefined;
  const inventoryFallback = plugin?.phase === 'BuildFailed' ? 'The plugin build failed.'
    : plugin?.phase === 'Stopped' ? 'The plugin is stopped.' : 'The plugin failed.';
  if (error !== null || devFailed || inventoryFailed) {
    return (
      <div className={styles.Root} role="alert">
        <Heading level={4}>Unable to load {id}</Heading>
        <Text tone="muted">
          {inventoryError ?? error?.message ?? plugin?.devError ?? plugin?.lastError
            ?? (inventoryFailed
              ? inventoryFallback + (plugin?.dev ? ' Restart the development server to try again.' : '')
              : 'The plugin development server is not running.')}
        </Text>
        {restart.variables === id && restart.error && (
          <Text tone="danger" role="alert">{restart.error instanceof Error ? restart.error.message : String(restart.error)}</Text>
        )}
        {plugin?.dev && (
          <Button size="sm" disabled={restart.isPending && restart.variables === id} onClick={() => {
            restart.mutate(id);
          }}>
            {restart.isPending && restart.variables === id ? 'Restarting…' : 'Restart dev server'}
          </Button>
        )}
        {plugin?.dev && (
          <Button size="sm" onClick={() => {
            devToolsChannel.emit('onOpenBuildOutput', id);
          }}>
            Open build output
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.Root} role="status" aria-live="polite">
      <Spinner size="lg" aria-hidden="true" />
      <Text>Loading {id}…</Text>
      {plugin?.dev && !plugin.devPort && (
        <Text size="sm" tone="muted">Waiting for the plugin development server…</Text>
      )}
    </div>
  );
}
