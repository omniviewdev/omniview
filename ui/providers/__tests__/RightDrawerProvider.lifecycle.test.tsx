import React, { type ReactNode, useContext } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionProvider,
  PluginWindow,
  RightDrawerContext,
  jsonToValue,
  type DrawerComponent,
  type DrawerContext,
  type HostRecord,
  type RightDrawerContextType,
} from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import type * as RuntimeApi from '@omniviewdev/runtime/api';

// These tests drive the production PluginService lifecycle, extension registry, built-in point
// registration, RightDrawerProvider, RightDrawer and the linked-resource drawer together. Only
// native transport (reads, connection state, notifications) and the Monaco editor are replaced.
const native = vi.hoisted(() => ({ get: vi.fn(), ready: vi.fn() }));

vi.mock('@omniviewdev/runtime', async () => {
  const actual = await vi.importActual<typeof Runtime>('@omniviewdev/runtime');
  return {
    ...actual,
    useNotifications: () => ({ notify: vi.fn() }),
    ConnectionBoundary: ({ children }: { children: ReactNode }): ReactNode => children,
    withConnectionReady: async (_pluginID: string, _connectionID: string, operation: () => Promise<unknown>) => {
      await native.ready();
      return operation();
    },
  };
});
vi.mock('@omniviewdev/runtime/api', async () => {
  const actual = await vi.importActual<typeof RuntimeApi>('@omniviewdev/runtime/api');
  return { ...actual, ResourceClient: { ...actual.ResourceClient, Get: native.get } };
});
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid='host-editor' />,
  DiffEditor: () => <div data-testid='host-diff-editor' />,
  useMonaco: () => undefined,
  loader: { init: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/components/displays/CodeEditor', () => ({ useResolvedMonacoTheme: () => 'ov-theme' }));
vi.mock('@/providers/monaco/useSchemaRegistration', () => ({
  useSchemaRegistration: () => ({ error: null, isLoading: false }),
}));

import RightDrawerProvider from '../RightDrawerProvider';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '@/features/extensions/drawer/extensionPoint';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '@/features/extensions/sidebar/extensionPoint';
import { PluginService } from '@/features/plugins/core/PluginService';
import { createTestDeps } from '@/features/plugins/testing/helpers';

afterEach(cleanup);

beforeEach(() => {
  native.get.mockReset();
  native.ready.mockReset().mockResolvedValue(undefined);
});

let drawer: RightDrawerContextType;
function DrawerProbe() {
  drawer = useContext(RightDrawerContext)!;
  return null;
}

function setup() {
  const t = createTestDeps();
  ensureBuiltinExtensionPointsRegistered(t.extensions);
  t.deps.ensureBuiltinExtensionPoints = () => {
    ensureBuiltinExtensionPointsRegistered(t.extensions);
  };

  const service = new PluginService(t.deps);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (children: ReactNode = null) => (
    <QueryClientProvider client={client}>
      <ExtensionProvider registry={t.extensions}>
        <RightDrawerProvider><DrawerProbe />{children}</RightDrawerProvider>
      </ExtensionProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  const registrations = () => ({
    drawers: t.extensions.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!.listAll().map(({ id }) => id),
    sidebars: t.extensions.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.listAll().map(({ id }) => id),
  });
  /** Re-renders the provider without touching the registry, as any unrelated update would. */
  const rerender = () => {
    view.rerender(tree(<span />));
  };

  return { ...t, service, view, registrations, rerender };
}

/**
 * A plugin renderer that reports its own lifetime and renders. A class stays off the compiler's
 * hook memoization, so every render the host asks for is visible.
 */
function tracked(label: string, events: string[]) {
  return class Tracked extends React.Component {
    componentDidMount() {
      events.push(`mount:${label}`);
    }

    componentWillUnmount() {
      events.push(`unmount:${label}`);
    }

    render() {
      events.push(`render:${label}`);
      return <span data-testid={`plugin-${label}`}>{label}</span>;
    }
  };
}

/** A legacy `drawers` export: the plugin owns the title, icon, views and actions. */
function drawerFactory(label: string, events: string[]) {
  const View = tracked(`${label}-view`, events);
  const Title = tracked(`${label}-title`, events);
  return (): DrawerComponent => ({
    title: <Title />,
    icon: <span />,
    views: [{ title: `${label} overview`, component: () => <View /> }],
    actions: [],
  });
}

/** A legacy `sidebars` export: the host's linked-resource drawer renders it as its overview. */
function sidebarComponent(label: string, events: string[]) {
  const Sidebar = tracked(`${label}-sidebar`, events);
  return function PluginSidebar(_props: { ctx: DrawerContext }) {
    return <Sidebar />;
  };
}

const pluginModule = (exports: { drawers?: Record<string, unknown>; sidebars?: Record<string, unknown> }) => ({
  plugin: new PluginWindow(),
  extensionRegistrations: [],
  sidebars: {},
  drawers: {},
  ...exports,
});

const target = (pluginID: string, type = 'widgets') => ({
  pluginID,
  targetId: 'host-target',
  route: { connection: 'connection' },
  reference: { address: { provider: pluginID, authority: 'host-issued', type, id: 'w1', scope: [] } },
  representation: 'json',
});

function observed(pluginID: string, type = 'widgets'): HostRecord {
  const { targetId, route, reference } = target(pluginID, type);
  return {
    key: 'host-key',
    addressKey: 'host-address',
    targetId,
    route,
    record: {
      reference,
      body: jsonToValue({ name: 'w1' }),
      representation: { id: 'json', revision: 'format-1' },
      coverage: { kind: 'complete', paths: [] },
    },
  };
}

const open = async (pluginID: string, type = 'widgets') => act(async () => {
  await drawer.showResourceSidebar({ ...target(pluginID, type), record: observed(pluginID, type), resourceName: 'w1' });
});

const unavailable = () => screen.getByRole('status');

/** Mounts and unmounts only; the number of renders is an implementation detail. */
const lifetimes = (events: string[]) => events.filter(event => !event.startsWith('render:')).sort();

describe('open drawers through the plugin lifecycle', () => {
  it('replaces a plugin drawer with the unavailable state when the plugin unloads', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', events) } }));
    await act(async () => s.service.load('A'));
    expect(s.registrations().drawers).toEqual(['A/drawer/widgets']);

    await open('A');
    expect(screen.getByTestId('plugin-v1-view')).toBeTruthy();
    expect(screen.getByTestId('plugin-v1-title')).toBeTruthy();
    expect(drawer.isOpen).toBe(true);

    await act(async () => s.service.unload('A'));
    expect(s.service.getPluginState('A')?.phase).toBe('idle');
    expect(s.registrations().drawers).toEqual([]);
    expect(unavailable().textContent).toContain('Unavailable');
    expect(unavailable().textContent).toContain('"A" plugin');
    expect(screen.queryByTestId('plugin-v1-view')).toBeNull();
    expect(screen.queryByTestId('plugin-v1-title')).toBeNull();
    expect(lifetimes(events)).toEqual(['mount:v1-title', 'mount:v1-view', 'unmount:v1-title', 'unmount:v1-view']);
    // The drawer chrome the host owns survives: the resource name and a working close.
    expect(screen.getByText('w1')).toBeTruthy();
    expect(drawer.isOpen).toBe(true);
  });

  it('keeps no plugin renderer reference once its plugin is unloaded', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', events) } }));
    await act(async () => s.service.load('A'));
    await open('A');
    await act(async () => s.service.unload('A'));
    const settled = [...events];

    // Unrelated updates must never ask the retired plugin to render again.
    s.rerender();
    s.rerender();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(events).toEqual(settled);
    expect(unavailable().textContent).toContain('Unavailable');
  });

  it('shows the unavailable state after a reload and serves the new plugin on reopen', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', events) } }));
    await act(async () => s.service.load('A'));
    await open('A');
    expect(screen.getByTestId('plugin-v1-view')).toBeTruthy();

    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v2', events) } }));
    await act(async () => s.service.reload('A'));
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.registrations().drawers).toEqual(['A/drawer/widgets']);
    // The open drawer was built from the replaced registration: it must not keep v1, and it must
    // not silently become v2 either, because the host cannot move a drawer between modules.
    expect(screen.queryByTestId('plugin-v1-view')).toBeNull();
    expect(screen.queryByTestId('plugin-v2-view')).toBeNull();
    expect(unavailable().textContent).toContain('reloaded');

    await open('A');
    expect(screen.getByTestId('plugin-v2-view')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(lifetimes(events.filter(event => event.endsWith('v1-view')))).toEqual(['mount:v1-view', 'unmount:v1-view']);
  });

  it('replaces the linked-resource drawer when the plugin sidebar it renders unloads', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ sidebars: { widgets: sidebarComponent('v1', events) } }));
    await act(async () => s.service.load('A'));
    expect(s.registrations().sidebars).toEqual(['A/sidebar/widgets']);

    await open('A');
    expect(screen.getByTestId('plugin-v1-sidebar')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Editor' })).toBeTruthy();

    await act(async () => s.service.unload('A'));
    expect(screen.queryByTestId('plugin-v1-sidebar')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Editor' })).toBeNull();
    expect(unavailable().textContent).toContain('Unavailable');
    expect(lifetimes(events)).toEqual(['mount:v1-sidebar', 'unmount:v1-sidebar']);
  });

  it('never opens a retired plugin drawer when the plugin unloads while the resource is being read', async () => {
    const s = setup();
    const events: string[] = [];
    const read = Promise.withResolvers<HostRecord | null>();
    native.get.mockReturnValueOnce(Object.assign(read.promise, { cancel: vi.fn() }));
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', events) } }));
    await act(async () => s.service.load('A'));

    let opening!: Promise<void>;
    await act(async () => {
      opening = drawer.showResourceSidebar({ ...target('A'), resourceName: 'w1' });
      await Promise.resolve();
    });
    expect(native.get).toHaveBeenCalledOnce();
    await act(async () => s.service.unload('A'));
    await act(async () => {
      read.resolve(observed('A'));
      await opening;
    });
    expect(drawer.isOpen).toBe(true);
    expect(unavailable().textContent).toContain('Unavailable');
    expect(events).toEqual([]);
  });

  it('leaves drawers that no plugin contribution supplied, and other plugins’ drawers, alone', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ drawers: { gadgets: drawerFactory('a', events) } }));
    s.importer.register('B', pluginModule({ drawers: { widgets: drawerFactory('b', events) } }));
    await act(async () => {
      await s.service.load('A');
      await s.service.load('B');
    });

    // No registration serves A's widgets, so the host builds the generic drawer itself.
    await open('A', 'widgets');
    expect(screen.getByTestId('host-editor')).toBeTruthy();
    await act(async () => s.service.unload('A'));
    await act(async () => s.service.reload('B'));
    expect(screen.getByTestId('host-editor')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    // A drawer served by B is not touched by A's lifecycle.
    await act(async () => s.service.load('A'));
    await open('B', 'widgets');
    expect(screen.getByTestId('plugin-b-view')).toBeTruthy();
    await act(async () => s.service.unload('A'));
    expect(screen.getByTestId('plugin-b-view')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => s.service.unload('B'));
    expect(unavailable().textContent).toContain('"B" plugin');
  });

  it('keeps a component the caller passed to openDrawer, which no contribution supplied', async () => {
    const s = setup();
    const events: string[] = [];
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', events) } }));
    await act(async () => s.service.load('A'));
    const Custom = tracked('custom', events);
    // Callers compiled against older runtimes pass a `resource` without `reference` or `route`.
    const legacyContext = { data: {}, resource: { id: 'w1', key: 'widgets', connectionID: 'c1' } } as unknown as DrawerContext;
    await act(async () => {
      drawer.openDrawer({ title: 'custom', views: [{ title: 'custom', component: () => <Custom /> }], actions: [] }, legacyContext);
    });
    await act(async () => s.service.unload('A'));
    expect(screen.getByTestId('plugin-custom')).toBeTruthy();
    expect(within(screen.getByRole('tablist')).getByRole('tab', { name: 'custom' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes cleanly from the unavailable state', async () => {
    const s = setup();
    s.importer.register('A', pluginModule({ drawers: { widgets: drawerFactory('v1', []) } }));
    await act(async () => s.service.load('A'));
    await open('A');
    await act(async () => s.service.unload('A'));
    await act(async () => {
      screen.getByRole('button', { name: 'Close' }).click();
    });
    expect(drawer.isOpen).toBe(false);
  });
});
