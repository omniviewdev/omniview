import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionProvider,
  PluginWindow,
  RESOURCE_CELL_EXTENSION_POINT_ID,
  type ResourceCellContribution,
  type ResourceCellProps,
} from '@omniviewdev/runtime';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { PluginService } from '@/features/plugins/core/PluginService';
import { PluginServiceContext } from '@/features/plugins/react/context';
import { createTestDeps } from '@/features/plugins/testing/helpers';
import CustomTableCell from './CustomTableCell';

// These tests drive the production PluginService lifecycle, extension registry, built-in point
// registration and CustomTableCell together. Only module transport is in-memory.

afterEach(cleanup);

function setup() {
  const t = createTestDeps();
  ensureBuiltinExtensionPointsRegistered(t.extensions);
  t.deps.ensureBuiltinExtensionPoints = () => {
    ensureBuiltinExtensionPointsRegistered(t.extensions);
  };

  const service = new PluginService(t.deps);
  const cellRegistrations = () => t.extensions.getExtensionPoint(RESOURCE_CELL_EXTENSION_POINT_ID)!.listAll();
  const show = (cells: Array<{ plugin: string; component?: string; resourceKey?: string }>) => render(
    <PluginServiceContext.Provider value={service}>
      <ExtensionProvider registry={t.extensions}>
        {cells.map(({ plugin, component = 'status', resourceKey = 'widgets' }) => (
          <div key={`${plugin}/${component}/${resourceKey}`} data-testid={`${plugin}/${component}/${resourceKey}`}>
            <CustomTableCell plugin={plugin} resourceKey={resourceKey} component={component} data='ok' />
          </div>
        ))}
      </ExtensionProvider>
    </PluginServiceContext.Provider>,
  );
  return { ...t, service, show, cellRegistrations };
}

/** Class components stay off the compiler's hook memoization and report their lifetime. */
function tracked(label: string, events: string[]) {
  return class Tracked extends React.Component<ResourceCellProps> {
    componentDidMount() {
      events.push(`mount:${label}`);
    }

    componentWillUnmount() {
      events.push(`unmount:${label}`);
    }

    render() {
      return <span>{label}:{String(this.props.data)}</span>;
    }
  };
}

const registration = (id: string, value: Partial<ResourceCellContribution> | Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
  registration: { id, label: id, value: { contractVersion: 1, name: 'status', ...value }, ...extra },
});

const pluginModule = (registrations: unknown[]) => ({
  plugin: new PluginWindow(),
  extensionRegistrations: registrations,
  sidebars: {},
  drawers: {},
});

const text = (testId: string) => screen.getByTestId(testId).textContent;

describe('custom resource cells through the plugin lifecycle', () => {
  it('renders a contributed cell through load, reload and unload', async () => {
    const s = setup();
    const events: string[] = [];
    s.show([{ plugin: 'A' }]);
    expect(text('A/status/widgets')).toBe('Unavailable');

    s.importer.register('A', pluginModule([registration('status-cell', { component: tracked('v1', events) })]));
    await act(async () => s.service.load('A'));
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(text('A/status/widgets')).toBe('v1:ok');
    expect(s.cellRegistrations().map(({ id, plugin }) => [id, plugin])).toEqual([['A/status-cell', 'A']]);

    s.importer.register('A', pluginModule([registration('status-cell', { component: tracked('v2', events) })]));
    await act(async () => s.service.reload('A'));
    expect(text('A/status/widgets')).toBe('v2:ok');
    expect(events).toEqual(['mount:v1', 'unmount:v1', 'mount:v2']);

    await act(async () => s.service.unload('A'));
    expect(s.service.getPluginState('A')?.phase).toBe('idle');
    expect(text('A/status/widgets')).toBe('Unavailable');
    expect(events).toEqual(['mount:v1', 'unmount:v1', 'mount:v2', 'unmount:v2']);
    expect(s.cellRegistrations()).toEqual([]);
    expect(s.service.getDebugSnapshot().plugins.A?.contributions).toEqual([]);

    s.importer.register('A', pluginModule([registration('status-cell', { component: tracked('v3', events) })]));
    await act(async () => s.service.load('A'));
    expect(text('A/status/widgets')).toBe('v3:ok');
  });

  it('serves one plugin’s columns per resource type without crossing plugins', async () => {
    const s = setup();
    s.show([
      { plugin: 'A', resourceKey: 'widgets' },
      { plugin: 'A', resourceKey: 'gadgets' },
      { plugin: 'B', resourceKey: 'widgets' },
    ]);
    s.importer.register('A', pluginModule([registration('widget-status', { resourceKeys: ['widgets'], component: tracked('A-widgets', []) })]));
    s.importer.register('B', pluginModule([registration('status', { component: tracked('B-any', []) })]));
    await act(async () => {
      await s.service.load('A');
      await s.service.load('B');
    });
    expect(text('A/status/widgets')).toBe('A-widgets:ok');
    expect(text('A/status/gadgets')).toBe('Unavailable');
    expect(text('B/status/widgets')).toBe('B-any:ok');

    await act(async () => s.service.unload('A'));
    expect(text('A/status/widgets')).toBe('Unavailable');
    expect(text('B/status/widgets')).toBe('B-any:ok');
  });

  it('takes ownership from the authenticated loader, never from the descriptor', async () => {
    const s = setup();
    s.show([{ plugin: 'victim' }, { plugin: 'rogue' }]);
    s.importer.register('rogue', pluginModule([registration('status', {
      component: tracked('rogue-cell', []),
      plugin: 'victim',
      pluginId: 'victim',
    }, { plugin: 'victim', meta: { pluginId: 'victim', plugin: 'victim' } })]));
    await act(async () => s.service.load('rogue'));
    expect(s.cellRegistrations().map(({ id, plugin }) => [id, plugin])).toEqual([['rogue/status', 'rogue']]);
    expect(text('victim/status/widgets')).toBe('Unavailable');
    expect(text('rogue/status/widgets')).toBe('rogue-cell:ok');
  });

  it('lets another plugin serve a provider only by explicit declaration, and releases it with that plugin', async () => {
    const s = setup();
    s.show([{ plugin: 'provider' }]);
    s.importer.register('shared-cells', pluginModule([registration('status', { component: tracked('shared', []), providers: ['provider'] })]));
    await act(async () => s.service.load('shared-cells'));
    expect(text('provider/status/widgets')).toBe('shared:ok');

    s.importer.register('provider', pluginModule([registration('status', { component: tracked('own', []) })]));
    await act(async () => s.service.load('provider'));
    expect(text('provider/status/widgets')).toBe('own:ok');

    await act(async () => s.service.unload('provider'));
    expect(text('provider/status/widgets')).toBe('shared:ok');
    await act(async () => s.service.unload('shared-cells'));
    expect(text('provider/status/widgets')).toBe('Unavailable');
  });

  it('keeps the plugin ready, isolates and diagnoses invalid contributions', async () => {
    const s = setup();
    s.show([{ plugin: 'A' }, { plugin: 'A', component: 'healthy' }]);
    s.importer.register('A', pluginModule([
      registration('bad-version', { contractVersion: 9, component: tracked('bad', []) }),
      registration('bad-types', { resourceKeys: ['*'], component: tracked('bad', []) }),
      registration('bad-component', { component: 'StatusCell' }),
      registration('healthy', { name: 'healthy', component: tracked('healthy', []) }),
      registration('healthy', { name: 'healthy', component: tracked('duplicate', []) }),
    ]));
    await act(async () => s.service.load('A'));
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.cellRegistrations().map(({ id }) => id)).toEqual(['A/healthy']);
    expect(text('A/status/widgets')).toBe('Unavailable');
    expect(text('A/healthy/widgets')).toBe('healthy:ok');

    const rejected = s.log.byLevel('warn').filter(({ message }) => message === `Rejected ${RESOURCE_CELL_EXTENSION_POINT_ID} contribution`);
    expect(rejected.map(({ data }) => [data?.contributionId, data?.reason])).toEqual([
      ['A/bad-version', 'Unsupported resource cell contract.'],
      ['A/bad-types', 'Resource cell resourceKeys must be a nonempty list of unique, exact resource type IDs.'],
      ['A/bad-component', 'Invalid resource cell component.'],
      ['A/healthy', 'Contribution with id "A/healthy" already exists in extension point "omniview/resource/cell"'],
    ]);
    expect(rejected.every(({ data }) => data?.pluginId === 'A' && data?.extensionPointId === RESOURCE_CELL_EXTENSION_POINT_ID)).toBe(true);
  });

  it('records a crashing renderer against its contribution without quarantining it, and recovers on reload', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = setup();
      s.show([{ plugin: 'A' }]);
      const Crashing = () => {
        throw new Error('render failure');
      };

      s.importer.register('A', pluginModule([registration('status-cell', { component: Crashing })]));
      await act(async () => s.service.load('A'));
      expect(text('A/status/widgets')).toBe('Failed to render');

      const crash = s.service.getDebugSnapshot().recentCrashes.at(-1);
      expect(crash).toMatchObject({
        contributionId: 'A/status-cell',
        pluginId: 'A',
        extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
        boundary: 'resource-cell',
        resourceKey: 'widgets',
        errorMessage: 'render failure',
      });
      expect(s.service.isQuarantined('A/status-cell')).toBe(false);

      s.importer.register('A', pluginModule([registration('status-cell', { component: tracked('fixed', []) })]));
      await act(async () => s.service.reload('A'));
      expect(text('A/status/widgets')).toBe('fixed:ok');
      expect(s.service.getDebugSnapshot().recentCrashes).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});
