// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionProvider } from './extensions/provider';
import { ExtensionPointRegistry } from './extensions/registry';
import { ResourceIcon, RESOURCE_ICON_EXTENSION_POINT_ID, type ResourceIconSetV1 } from './resourceIcons';

afterEach(cleanup);
function setup() {
  const registry = new ExtensionPointRegistry();
  registry.addExtensionPoint<ResourceIconSetV1>({ id: RESOURCE_ICON_EXTENSION_POINT_ID, pluginId: 'core' });
  const store = registry.getExtensionPoint<ResourceIconSetV1>(RESOURCE_ICON_EXTENSION_POINT_ID)!;
  const show = () => render(<ExtensionProvider registry={registry}><ResourceIcon pluginId="native" resourceKey="opaque" fallback={<span>fallback</span>} /></ExtensionProvider>);
  return { registry, store, show };
}
const icon = (label: string): ResourceIconSetV1 => ({ schemaVersion: 1, resolve: () => () => <span>{label}</span> });
describe('ResourceIcon', () => {
  it('never calls foreign owners and falls back for unknown keys', () => {
    const { store, show } = setup();
    const foreign = vi.fn(() => () => <span>foreign</span>);
    store.register({ id: 'foreign', plugin: 'other', label: '', value: { schemaVersion: 1, resolve: foreign } });
    store.register({ id: 'unknown', plugin: 'native', label: '', value: { schemaVersion: 1, resolve: () => undefined } });
    show();
    expect(foreign).not.toHaveBeenCalled();
    expect(screen.getByText('fallback')).toBeTruthy();
  });
  it('updates mounted consumers on replacement and unload', async () => {
    const { store, registry, show } = setup();
    store.register({ id: 'icons', plugin: 'native', label: '', value: icon('first') });
    show();
    expect(screen.getByText('first')).toBeTruthy();
    await act(async () => { store.unregister('icons'); store.register({ id: 'icons', plugin: 'native', label: '', value: icon('second') }); });
    expect(await screen.findByText('second')).toBeTruthy();
    await act(async () => registry.removeContributions('native'));
    expect(await screen.findByText('fallback')).toBeTruthy();
  });
  it('follows a replaced extension point and its subsequent contribution updates', async () => {
    const { registry, store, show } = setup();
    store.register({ id: 'icons', plugin: 'native', label: '', value: icon('original') });
    show();
    expect(screen.getByText('original')).toBeTruthy();
    await act(async () => registry.removeExtensionPoints('core'));
    expect(screen.getByText('fallback')).toBeTruthy();
    await act(async () => {
      registry.addExtensionPoint<ResourceIconSetV1>({ id: RESOURCE_ICON_EXTENSION_POINT_ID, pluginId: 'core' });
    });
    const replacement = registry.getExtensionPoint<ResourceIconSetV1>(RESOURCE_ICON_EXTENSION_POINT_ID)!;
    await act(async () => replacement.register({ id: 'new-icons', plugin: 'native', label: '', value: icon('replacement') }));
    expect(screen.getByText('replacement')).toBeTruthy();
    await act(async () => replacement.unregister('new-icons'));
    expect(screen.getByText('fallback')).toBeTruthy();
  });
  it('isolates resolver failures', () => {
    const { store, show } = setup();
    store.register({ id: 'bad', plugin: 'native', label: '', value: { schemaVersion: 1, resolve() { throw new Error('resolver'); } } });
    show();
    expect(screen.getByText('fallback')).toBeTruthy();
  });
  it('isolates render failures and recovers when contribution changes', async () => {
    const { store, show } = setup();
    store.register({ id: 'icons', plugin: 'native', label: '', value: { schemaVersion: 1, resolve: () => () => { throw new Error('render'); } } });
    show();
    expect(screen.getByText('fallback')).toBeTruthy();
    await act(async () => { store.unregister('icons'); store.register({ id: 'icons', plugin: 'native', label: '', value: icon('recovered') }); });
    expect(await screen.findByText('recovered')).toBeTruthy();
  });
});

describe('lazy resource icons', () => {
  it('keeps sibling content visible while loading and after a lazy rejection', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { registry, store } = setup();
      const { promise, reject } = Promise.withResolvers<{ default: React.ComponentType }>();
      const LazyIcon = React.lazy(() => promise);
      store.register({ id: 'lazy', plugin: 'native', label: '', value: { schemaVersion: 1, resolve: () => LazyIcon } });
      render(<ExtensionProvider registry={registry}><span>shell</span><ResourceIcon pluginId="native" resourceKey="opaque" fallback={<span>fallback</span>} /></ExtensionProvider>);
      expect(screen.getByText('shell')).toBeTruthy();
      expect(screen.getByText('fallback')).toBeTruthy();
      await act(async () => { reject(new Error('lazy load')); });
      expect(screen.getByText('shell')).toBeTruthy();
      expect(screen.getByText('fallback')).toBeTruthy();
    } finally { log.mockRestore(); }
  });

  it('renders a lazy icon once loading completes', async () => {
    const { store, show } = setup();
    const { promise, resolve } = Promise.withResolvers<{ default: React.ComponentType }>();
    const LazyIcon = React.lazy(() => promise);
    store.register({ id: 'lazy', plugin: 'native', label: '', value: { schemaVersion: 1, resolve: () => LazyIcon } });
    show();
    expect(screen.getByText('fallback')).toBeTruthy();
    await act(async () => { resolve({ default: () => <span>loaded</span> }); });
    expect(screen.getByText('loaded')).toBeTruthy();
  });
});
