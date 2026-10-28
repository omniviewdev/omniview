import { lazy, memo, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionPointRegistry, usePluginContext, type SearchProviderV1 } from '@omniviewdev/runtime';
import { createDeferred } from '../plugins/testing/helpers';
import { ensureBuiltinExtensionPointsRegistered } from '../extensions/registerBuiltinExtensionPoints';
import { createGlobalSearchController } from './controller';
import { SearchProviderContexts, type SearchProviderContextRegistration } from './SearchProviderContexts';

const native = vi.hoisted(() => ({
  metadata: vi.fn(async (id: string) => ({ id, name: id })),
  settings: vi.fn(async () => ({})),
}));
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({ GetPluginMeta: native.metadata }));
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/settings/servicewrapper', () => ({ PluginValues: native.settings }));

afterEach(() => {
  cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); 
});

function SettingsContext() {
  const { pluginId } = usePluginContext();
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => {
      setOpen(true); 
    }}>Settings for {pluginId}</button>
    {open && <div role='dialog' aria-label={`Settings ${pluginId}`}>
      <button onClick={() => {
        setOpen(false); 
      }}>Cancel {pluginId}</button>
    </div>}
  </>;
}

describe('search provider contexts', () => {
  it('keeps memoized plugin dialogs isolated and shares one metadata context per owner', async () => {
    const Component = memo(SettingsContext);
    const entries: SearchProviderContextRegistration[] = [
      { key: 'aws/a/1', sourceId: 'aws/a', pluginId: 'aws', Component },
      { key: 'aws/b/1', sourceId: 'aws/b', pluginId: 'aws', Component: () => null },
      { key: 'oci/a/1', sourceId: 'oci/a', pluginId: 'oci', Component },
    ];
    const view = render(<SearchProviderContexts contexts={entries} controller={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings for aws' }));
    expect(screen.getByRole('dialog', { name: 'Settings aws' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Settings oci' })).toBeNull();
    expect(native.metadata.mock.calls.filter(([id]) => id === 'aws')).toHaveLength(1);
    view.rerender(<SearchProviderContexts contexts={entries.slice(2)} controller={null} />);
    expect(screen.queryByRole('dialog', { name: 'Settings aws' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Settings for oci' }));
    expect(screen.getByRole('dialog', { name: 'Settings oci' })).toBeVisible();
  });

  it('loads lazy contexts without replacing the shell and removes their dialogs on unregister', async () => {
    const module = createDeferred<{ default: typeof SettingsContext }>();
    const Component = lazy(async () => module.promise);
    const entries = [{ key: 'proxmox/a/1', sourceId: 'proxmox/a', pluginId: 'proxmox', Component }];
    const view = render(<><button>Host navigation</button><SearchProviderContexts contexts={entries} controller={null} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Host navigation' }));
    await act(async () => {
      module.resolve({ default: SettingsContext }); 
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Settings for proxmox' }));
    expect(screen.getByRole('dialog', { name: 'Settings proxmox' })).toBeVisible();
    view.rerender(<><button>Host navigation</button><SearchProviderContexts contexts={[]} controller={null} /></>);
    expect(screen.queryByRole('dialog', { name: 'Settings proxmox' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Host navigation' })).toBeEnabled();
  });

  it('fences a failed context without preventing another source from navigating', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = new ExtensionPointRegistry();
    ensureBuiltinExtensionPointsRegistered(registry);
    const store = registry.getExtensionPoint('omniview/global-search')!;
    const provider = (label: string): SearchProviderV1 => ({ schemaVersion: 1, kind: 'provider', search: async () => ({
      items: [{ id: label, label, value: { schemaVersion: 1, kind: 'navigation', target: { kind: 'core', path: '/plugins' } } }], completion: 'complete',
    }) });
    store.register({ id: 'aws/broken', plugin: 'aws', label: 'Broken', value: provider('Broken result') });
    store.register({ id: 'oci/healthy', plugin: 'oci', label: 'Healthy', value: provider('Healthy result') });
    const navigate = vi.fn();
    const controller = createGlobalSearchController({ registry, isPluginReady: () => true, hasPluginRoute: () => true,
      listResourcePlugins: async () => [], loadConnections: async () => [], navigate });
    controller.open();
    function Broken(): never {
      throw new Error('Plugin context failed'); 
    }

    render(<SearchProviderContexts contexts={[{ key: 'aws/broken/1', sourceId: 'aws/broken', pluginId: 'aws', Component: Broken }]} controller={controller} />);
    await waitFor(() => {
      expect(controller.getSnapshot().sources.find(source => source.id === 'aws/broken')?.state).toBe('unavailable'); 
    });
    expect(controller.getSnapshot().rows.some(row => row.label === 'Broken result')).toBe(false);
    const row = controller.getSnapshot().rows.find(item => item.label === 'Healthy result');
    expect(row).toBeDefined();
    await controller.activate(row!.key);
    expect(navigate).toHaveBeenCalledWith('/plugins');
    controller.dispose();
  });
});
