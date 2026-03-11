import { describe, it, expect, beforeEach } from 'vitest';
import { PluginWindow } from '@omniviewdev/runtime';
import {
  createTestDeps,
  InMemoryModuleImporter,
  InMemoryEventBus,
  LogCapture,
  createDeferred,
} from './helpers';
import { MissingExtensionPointError } from '../core/errors';
import type { TestDeps } from './helpers';

// ─── Test Module Factories ──────────────────────────────────────────

function validModule(overrides?: {
  sidebars?: Record<string, () => null>;
  drawers?: Record<string, () => any>;
  extensionRegistrations?: any[];
}) {
  return {
    plugin: new PluginWindow(),
    sidebars: overrides?.sidebars ?? {},
    drawers: overrides?.drawers ?? {},
    extensionRegistrations: overrides?.extensionRegistrations ?? [],
  };
}

// ─── Group 15.5: Runtime Extension Registry Contract ────────────────

describe('Group 15.5: Runtime Extension Registry Contract (via test deps)', () => {
  let t: TestDeps;

  beforeEach(() => {
    t = createTestDeps();
  });

  // 15.5 #19: Matcher honored in single mode
  it('#19 matcher honored in single mode', () => {
    t.extensions.addExtensionPoint({
      id: 'test/sidebar',
      pluginId: 'core',
      mode: 'single',
      matcher: (contribution, context: any) => {
        const meta = contribution.meta as { resourceKey?: string } | undefined;
        return meta?.resourceKey === context?.resourceKey;
      },
      select: (contributions) => contributions[0],
    });

    const store = t.extensions.getExtensionPoint('test/sidebar')!;
    store.register({
      id: 'c1',
      plugin: 'pluginA',
      label: 'Sidebar A',
      value: () => null,
      meta: { resourceKey: 'core::v1::Pod' },
    });
    store.register({
      id: 'c2',
      plugin: 'pluginB',
      label: 'Sidebar B',
      value: () => null,
      meta: { resourceKey: 'apps::v1::Deployment' },
    });

    const result = store.provide({ resourceKey: 'core::v1::Pod' } as any);
    expect(result).toHaveLength(1);
  });

  // 15.5 #20: Cache invalidated on register
  it('#20 cache invalidated on register', () => {
    t.extensions.addExtensionPoint({
      id: 'test/ep',
      pluginId: 'core',
      mode: 'multiple',
    });

    const store = t.extensions.getExtensionPoint('test/ep')!;

    // Prime cache
    expect(store.provide()).toHaveLength(0);

    // Register
    store.register({
      id: 'c1',
      plugin: 'pluginA',
      label: 'C1',
      value: 'val1',
    });

    // Cache should be invalidated — new value visible
    expect(store.provide()).toHaveLength(1);
  });

  // 15.5 #21: Cache invalidated on removeContributions
  it('#21 cache invalidated on removeContributions(pluginId)', () => {
    t.extensions.addExtensionPoint({
      id: 'test/ep',
      pluginId: 'core',
      mode: 'multiple',
    });

    const store = t.extensions.getExtensionPoint('test/ep')!;
    store.register({
      id: 'c1',
      plugin: 'pluginA',
      label: 'C1',
      value: 'val1',
    });

    // Prime cache
    expect(store.provide()).toHaveLength(1);

    // Remove
    t.extensions.removeContributions('pluginA');

    // Cache invalidated — removed values gone
    expect(store.provide()).toHaveLength(0);
  });

  // 15.5 #22: Subscription fires on contribution change
  it('#22 subscription fires on contribution change', () => {
    t.extensions.addExtensionPoint({
      id: 'test/ep',
      pluginId: 'core',
      mode: 'multiple',
    });

    let storeNotifyCount = 0;
    const store = t.extensions.getExtensionPoint('test/ep')!;
    store.subscribe(() => {
      storeNotifyCount++;
    });

    store.register({
      id: 'c1',
      plugin: 'pluginA',
      label: 'C1',
      value: 'val1',
    });
    expect(storeNotifyCount).toBe(1);

    store.unregister('c1');
    expect(storeNotifyCount).toBe(2);
  });

  // 15.5 #23: removeExtensionPoints removes plugin-owned definitions
  it('#23 removeExtensionPoints(pluginId) removes plugin-owned definitions', () => {
    t.extensions.addExtensionPoint({
      id: 'test/plugin-ep',
      pluginId: 'pluginA',
      mode: 'multiple',
    });

    expect(t.extensions.hasExtensionPoint('test/plugin-ep')).toBe(true);

    t.extensions.removeExtensionPoints('pluginA');

    expect(t.extensions.hasExtensionPoint('test/plugin-ep')).toBe(false);
  });

  // 15.5 #24: Registry accepts non-component values
  it('#24 registry accepts non-component values', () => {
    t.extensions.addExtensionPoint({
      id: 'test/drawer',
      pluginId: 'core',
      mode: 'single',
    });

    const drawerFactory = () => ({ views: [] });
    const store = t.extensions.getExtensionPoint('test/drawer')!;
    store.register({
      id: 'df1',
      plugin: 'pluginA',
      label: 'Drawer Factory',
      value: drawerFactory,
    });

    const result = store.provide();
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(drawerFactory);
  });
});

// ─── Adapter Alignment: registerContribution throws on missing EP ───

describe('Adapter alignment: registerContribution', () => {
  let t: TestDeps;

  beforeEach(() => {
    t = createTestDeps();
  });

  it('throws MissingExtensionPointError for non-existent extension point', () => {
    expect(() =>
      t.deps.registerContribution('nonexistent/ep', {
        id: 'c1',
        plugin: 'pluginA',
        label: 'C1',
        value: 'val',
      }),
    ).toThrow(MissingExtensionPointError);
  });

  it('MissingExtensionPointError includes extensionPointId and pluginId', () => {
    try {
      t.deps.registerContribution('nonexistent/ep', {
        id: 'c1',
        plugin: 'pluginA',
        label: 'C1',
        value: 'val',
      });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingExtensionPointError);
      const err = e as MissingExtensionPointError;
      expect(err.extensionPointId).toBe('nonexistent/ep');
      expect(err.pluginId).toBe('pluginA');
    }
  });

  it('succeeds when extension point exists', () => {
    t.deps.addExtensionPoint({
      id: 'test/ep',
      pluginId: 'core',
      mode: 'multiple',
    });

    expect(() =>
      t.deps.registerContribution('test/ep', {
        id: 'c1',
        plugin: 'pluginA',
        label: 'C1',
        value: 'val',
      }),
    ).not.toThrow();
  });
});

// ─── Adapter Alignment: addExtensionPoint throws on duplicate ───────

describe('Adapter alignment: addExtensionPoint', () => {
  let t: TestDeps;

  beforeEach(() => {
    t = createTestDeps();
  });

  it('throws on duplicate extension point ID', () => {
    t.deps.addExtensionPoint({
      id: 'test/ep',
      pluginId: 'pluginA',
      mode: 'multiple',
    });

    expect(() =>
      t.deps.addExtensionPoint({
        id: 'test/ep',
        pluginId: 'pluginB',
        mode: 'multiple',
      }),
    ).toThrow(/already exists/);
  });
});

// ─── Adapter Alignment: validateExports is wired ────────────────────

describe('Adapter alignment: validateExports', () => {
  let t: TestDeps;

  beforeEach(() => {
    t = createTestDeps();
  });

  it('validates valid module exports', () => {
    const result = t.deps.validateExports(validModule());
    expect(result.plugin).toBeDefined();
    expect(result.extensionRegistrations).toEqual([]);
    expect(result.sidebars).toEqual({});
    expect(result.drawers).toEqual({});
  });

  it('rejects null exports', () => {
    expect(() => t.deps.validateExports(null)).toThrow(/null/);
  });

  it('rejects missing plugin', () => {
    expect(() => t.deps.validateExports({})).toThrow(/plugin/i);
  });
});

// ─── InMemoryModuleImporter ─────────────────────────────────────────

describe('InMemoryModuleImporter', () => {
  it('returns registered module', async () => {
    const importer = new InMemoryModuleImporter();
    const mod = validModule();
    importer.register('pluginA', mod);

    const result = await importer.importPlugin({ pluginId: 'pluginA' });
    expect(result).toBe(mod);
  });

  it('throws for unregistered module', async () => {
    const importer = new InMemoryModuleImporter();
    await expect(
      importer.importPlugin({ pluginId: 'missing' }),
    ).rejects.toThrow(/not registered/);
  });

  it('supports factory functions', async () => {
    const importer = new InMemoryModuleImporter();
    const mod = validModule();
    importer.register('pluginA', () => mod);

    const result = await importer.importPlugin({ pluginId: 'pluginA' });
    expect(result).toBe(mod);
  });

  it('tracks import count', async () => {
    const importer = new InMemoryModuleImporter();
    importer.register('a', validModule());
    importer.register('b', validModule());

    expect(importer.importCount).toBe(0);
    await importer.importPlugin({ pluginId: 'a' });
    expect(importer.importCount).toBe(1);
    await importer.importPlugin({ pluginId: 'b' });
    expect(importer.importCount).toBe(2);
  });
});

// ─── InMemoryEventBus ───────────────────────────────────────────────

describe('InMemoryEventBus', () => {
  it('delivers events to handlers', () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.onEvent('test', (msg: string) => received.push(msg));

    bus.emit('test', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('unsubscribe removes handler', () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    const unsub = bus.onEvent('test', (msg: string) => received.push(msg));

    bus.emit('test', 'first');
    unsub();
    bus.emit('test', 'second');

    expect(received).toEqual(['first']);
  });

  it('hasHandlers reports correctly', () => {
    const bus = new InMemoryEventBus();
    expect(bus.hasHandlers('test')).toBe(false);

    const unsub = bus.onEvent('test', () => {});
    expect(bus.hasHandlers('test')).toBe(true);

    unsub();
    expect(bus.hasHandlers('test')).toBe(false);
  });
});

// ─── LogCapture ─────────────────────────────────────────────────────

describe('LogCapture', () => {
  it('captures logs by level', () => {
    const log = new LogCapture();
    log.logger.debug('d1');
    log.logger.warn('w1');
    log.logger.error('e1');
    log.logger.debug('d2');

    expect(log.byLevel('debug')).toHaveLength(2);
    expect(log.byLevel('warn')).toHaveLength(1);
    expect(log.byLevel('error')).toHaveLength(1);
  });

  it('clear resets logs', () => {
    const log = new LogCapture();
    log.logger.debug('d1');
    log.clear();
    expect(log.logs).toHaveLength(0);
  });
});

// ─── Deferred ───────────────────────────────────────────────────────

describe('createDeferred', () => {
  it('resolve works', async () => {
    const d = createDeferred<string>();
    d.resolve('done');
    await expect(d.promise).resolves.toBe('done');
  });

  it('reject works', async () => {
    const d = createDeferred<string>();
    d.reject(new Error('fail'));
    await expect(d.promise).rejects.toThrow('fail');
  });
});

// ─── Test/Production Behavioral Consistency ─────────────────────────

describe('Test deps behavioral consistency with production contract', () => {
  let t: TestDeps;

  beforeEach(() => {
    t = createTestDeps();
  });

  it('removeContributions removes all contributions for a plugin', () => {
    t.deps.addExtensionPoint({ id: 'ep1', pluginId: 'core', mode: 'multiple' });
    t.deps.addExtensionPoint({ id: 'ep2', pluginId: 'core', mode: 'multiple' });

    t.deps.registerContribution('ep1', {
      id: 'c1', plugin: 'pluginA', label: 'C1', value: 'v1',
    });
    t.deps.registerContribution('ep2', {
      id: 'c2', plugin: 'pluginA', label: 'C2', value: 'v2',
    });
    t.deps.registerContribution('ep1', {
      id: 'c3', plugin: 'pluginB', label: 'C3', value: 'v3',
    });

    t.deps.removeContributions('pluginA');

    const ep1 = t.extensions.getExtensionPoint('ep1')!;
    const ep2 = t.extensions.getExtensionPoint('ep2')!;

    // pluginA contributions removed
    expect(ep1.provide()).toHaveLength(1); // only pluginB's c3 remains
    expect(ep2.provide()).toHaveLength(0);
  });

  it('removeExtensionPoints only removes plugin-owned EPs', () => {
    t.deps.addExtensionPoint({ id: 'ep-core', pluginId: 'core', mode: 'multiple' });
    t.deps.addExtensionPoint({ id: 'ep-plugin', pluginId: 'pluginA', mode: 'multiple' });

    t.deps.removeExtensionPoints('pluginA');

    expect(t.extensions.hasExtensionPoint('ep-core')).toBe(true);
    expect(t.extensions.hasExtensionPoint('ep-plugin')).toBe(false);
  });

  it('registerContribution is visible via provide()', () => {
    t.deps.addExtensionPoint({ id: 'test/ep', pluginId: 'core', mode: 'multiple' });

    t.deps.registerContribution('test/ep', {
      id: 'c1', plugin: 'pluginA', label: 'C1', value: 'hello',
    });

    const store = t.extensions.getExtensionPoint('test/ep')!;
    const values = store.provide();
    expect(values).toHaveLength(1);
    expect(values[0]).toBe('hello');
  });

  it('deps.validateExports is the real validator', () => {
    // Verify it rejects malformed exports the same way production would
    expect(() => t.deps.validateExports({ plugin: 'not-an-object' })).toThrow(/object/);

    // Verify it accepts valid exports
    const result = t.deps.validateExports(validModule());
    expect(result.plugin).toBeDefined();
  });
});
