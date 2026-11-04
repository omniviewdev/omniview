import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionProvider, PluginWindow, useExtensionPointSnapshot, ConnectionSettingsContributions, PLUGIN_SETTINGS_EXTENSION_POINT_ID, CONNECTION_SETTINGS_EXTENSION_POINT_ID } from '@omniviewdev/runtime';
import type { PluginServiceDeps } from '../core/types';
import { createTestDeps } from '../testing/helpers';
import { createPluginModuleResolver, type BuiltinModuleRegistry } from '../adapters/builtinModules';
import type * as BuiltinModules from '../adapters/builtinModules';
import type { JSX } from 'react';
const backend = vi.hoisted(() => ({ deps: null as PluginServiceDeps | null }));
vi.mock('../adapters/createProductionDeps', () => ({ createProductionDeps: () => backend.deps }));
vi.mock('@/hooks/plugin/useInstalledPlugins', () => ({ useInstalledPlugins: () => ({ isLoading: false, error: null, plugins: [
  { id: 'provider', origin: 'builtin', frontendModule: 'startup/ui', dev: false, enabled: true },
  { id: 'lazy', origin: 'builtin', frontendModule: 'lazy/ui', dev: false, enabled: true },
  { id: 'disabled', origin: 'builtin', frontendModule: 'disabled/ui', dev: false, enabled: false },
] }) }));
vi.mock('../adapters/builtinModules', async importOriginal => ({
  ...await importOriginal<typeof BuiltinModules>(),
  builtinModules: { 'startup/ui': { activation: 'startup' }, 'lazy/ui': {}, 'disabled/ui': { activation: 'startup' } },
}));
import { PluginServiceProvider } from './PluginServiceProvider';
function SettingsBody() {
  const { contributions } = useExtensionPointSnapshot<{ component: () => JSX.Element }>(PLUGIN_SETTINGS_EXTENSION_POINT_ID);
  return <>{contributions.map(contribution => { const Body = contribution.value.component; return <Body key={contribution.id} />; })}</>;
}
afterEach(cleanup);
describe('per-document built-in startup contributions', () => {
  it.each(['main', 'settings'])('loads opted-in contributions through normal backend-first resolver in %s document', async () => {
    const test = createTestDeps(); backend.deps = test.deps;
    const order: string[] = [];
    const descriptors = {
      provider: { id: 'provider', origin: 'builtin' as const, frontendModule: 'startup/ui', dev: false, enabled: true },
      lazy: { id: 'lazy', origin: 'builtin' as const, frontendModule: 'lazy/ui', dev: false, enabled: true },
      disabled: { id: 'disabled', origin: 'builtin' as const, frontendModule: 'disabled/ui', dev: false, enabled: false },
    };
    for (const id of [PLUGIN_SETTINGS_EXTENSION_POINT_ID, CONNECTION_SETTINGS_EXTENSION_POINT_ID]) test.extensions.addExtensionPoint({ id, pluginId: 'core', mode: 'multiple' });
    const registry: BuiltinModuleRegistry = {
      'startup/ui': { activation: 'startup', routes: [{ path: '/' }], load: async () => {
        order.push('import:provider');
        return { plugin: new PluginWindow().withRoutes([{ path: '/', Component: () => <h1>Provider root</h1> }]), extensionRegistrations: [
          { extensionPointId: PLUGIN_SETTINGS_EXTENSION_POINT_ID, registration: { id: 'global', plugin: 'provider', label: 'Global', value: { contractVersion: 1, label: 'Provider', component: () => <h2>Provider global settings</h2> } } },
          { extensionPointId: CONNECTION_SETTINGS_EXTENSION_POINT_ID, registration: { id: 'connection', plugin: 'provider', label: 'Connection', value: { contractVersion: 1, label: 'Provider metrics', signals: ['metrics'], component: () => <h2>Provider connection settings</h2> } } },
        ] };
      } },
      'lazy/ui': { routes: [], load: async () => { throw new Error('On-demand module must stay unevaluated'); } },
      'disabled/ui': { activation: 'startup', routes: [], load: async () => { throw new Error('Disabled module must stay unevaluated'); } },
    };
    test.deps.getPluginDescriptor = async id => descriptors[id as keyof typeof descriptors];
    test.deps.importPlugin = createPluginModuleResolver({ getDescriptor: test.deps.getPluginDescriptor,
      activateBackend: async id => { order.push(`activate:${id}`); }, importExternal: test.importer.importPlugin, registry });
    render(<ExtensionProvider registry={test.extensions}><PluginServiceProvider><SettingsBody /><ConnectionSettingsContributions resourcePluginID="resource-owner" connectionID="cluster" signal="metrics" catalogRevision="1" publicMetadata={{}} resourceTypes={[]} /></PluginServiceProvider></ExtensionProvider>);
    expect(await screen.findByRole('heading', { name: 'Provider global settings' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Provider connection settings' })).toBeVisible();
    expect(order).toEqual(['activate:provider', 'import:provider']);
    expect(test.importer.importCount).toBe(0);
  });
});
