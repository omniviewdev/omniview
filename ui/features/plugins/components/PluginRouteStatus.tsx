import { Button, Heading, Spinner, Text } from '@omniviewdev/base-ui';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import { useParams } from 'react-router-dom';
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
  if (error !== null || devFailed || inventoryFailed) {
    return (
      <div className={styles.Root} role="alert">
        <Heading level={4}>Unable to load {id}</Heading>
        <Text tone="muted">
          {error?.message ?? plugin?.devError ?? plugin?.lastError
            ?? (inventoryFailed
              ? `The plugin is ${plugin?.phase?.toLowerCase()}. Restart the plugin to try again.`
              : 'The plugin development server is not running.')}
        </Text>
        {plugin?.dev && (
          <Button size="sm" onClick={() => {
            devToolsChannel.emit('onRestartDevServer', id); 
          }}>
            Restart dev server
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
