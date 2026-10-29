import { Outlet } from 'react-router';
import { PluginProvider } from '@/providers/plugin/PluginProvider';

/**
 * Simple container to inject the plugin context into a viewable container..
 */
export default function PluginContainer() {
  return (
    <PluginProvider>
      <Outlet />
    </PluginProvider>
  );
}
