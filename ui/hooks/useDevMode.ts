import { useInstalledPlugins } from '@/hooks/plugin/useInstalledPlugins';

/**
 * Returns true when at least one plugin is installed in dev mode,
 * which activates visibility of dev-only settings.
 */
export function useDevMode(): boolean {
  const { plugins } = useInstalledPlugins();
  return plugins.some(p => p.dev);
}
