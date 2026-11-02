import { describe, expect, it, vi } from 'vitest';
import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import type { PluginServiceDebugSnapshot } from '@/features/plugins/core/types';
import { DEFAULT_CONFIG } from '@/features/plugins/core/types';
import { assertDiagnosticSnapshotCurrent, captureExtensionSnapshot, filterExtensionSnapshot, lookupExtensionContext, recoverExtensionContribution } from './model';
import type { DiagnosticService } from './model';
import { createResourceSidebarExtensionPoint, RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '../sidebar/extensionPoint';

function fixture() {
  const debug: PluginServiceDebugSnapshot = {
    plugins: {}, config: DEFAULT_CONFIG, ready: true, routeVersion: 0,
    eventListenersActive: true, pendingContributions: {}, quarantinedContributions: [], recentCrashes: [],
  };
  const service: DiagnosticService = {
    getDebugSnapshot: () => debug, subscribe: () => () => undefined,
    onQuarantineActivated: () => () => undefined, unquarantine: vi.fn(),
  };
  return { debug, service, registry: new ExtensionPointRegistry() };
}

describe('extension diagnostics capture', () => {
  it('preserves real inventory while identity is unavailable and prohibits recovery without an actual window', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint({ id: 'test/point' });
    registry.getExtensionPoint('test/point')!.register({ id: 'entry', plugin: 'test', label: 'Entry', value: null });
    const pendingIdentity = captureExtensionSnapshot(registry, service, { windowName: '' });
    expect(pendingIdentity.windowName).toBe('');
    expect(pendingIdentity.points[0].contributions[0].id).toBe('entry');
    expect(pendingIdentity.coverage[0]).toContain('identity is unavailable');
    expect(() => {
      assertDiagnosticSnapshotCurrent(pendingIdentity); 
    }).toThrow('identity is unavailable');
    expect(() => {
      recoverExtensionContribution(registry, service, 'entry', pendingIdentity); 
    }).toThrow('identity is unavailable');
    expect(service.unquarantine).not.toHaveBeenCalled();
    const resolvedIdentity = captureExtensionSnapshot(registry, service, { windowName: 'browser-3' });
    expect(resolvedIdentity.windowName).toBe('browser-3');
    expect(() => {
      assertDiagnosticSnapshotCurrent(resolvedIdentity); 
    }).not.toThrow();
  });

  it('captures all single-mode registrations without calling matchers or selectors', () => {
    const { registry, service } = fixture();
    const matcher = vi.fn(() => true);
    const select = vi.fn((entries: Array<{ id: string; plugin: string; label: string; value: unknown }>) => entries[0]);
    registry.addExtensionPoint({ id: 'test/point', mode: 'single', matcher, select });
    const point = registry.getExtensionPoint('test/point')!;
    point.register({ id: 'first', plugin: 'test', label: 'First', value: () => null });
    point.register({ id: 'second', plugin: 'other', label: 'Second', value: 4 });
    const snapshot = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(snapshot.points[0].contributions.map(entry => entry.id)).toEqual(['first', 'second']);
    expect(filterExtensionSnapshot(snapshot, { query: 'second' }).points[0].contributions[0].id).toBe('second');
    expect(matcher).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(Object.isFrozen(snapshot.points[0].contributions)).toBe(true);
  });

  it('does not traverse plugin values, metadata, accessors, or custom coercion', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint({ id: 'test/point' });
    const getter = vi.fn(() => {
      throw new Error('must not read'); 
    });
    const value = new Proxy({}, { ownKeys: getter, get: getter });
    const entry = { id: 'safe', plugin: 'test', label: 'Safe', value, meta: value };
    Object.defineProperty(entry, 'label', { get: getter });
    const point = registry.getExtensionPoint('test/point')!;
    point.register(entry);
    const snapshot = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(snapshot.points[0].contributions[0]).toMatchObject({ id: 'safe', label: '', valueType: 'object' });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain('must not read');
  });

  it('joins pending targets, crashes, quarantine, failures and dependency warnings', () => {
    const { registry, service, debug } = fixture();
    debug.plugins.test = {
      id: 'test', phase: 'error', backendPhase: null, error: 'secret token', retryCount: 0, loadedAt: null,
      isDev: false, devPort: null, pluginWindow: null, validationErrors: [], moduleHash: null,
      inflightLoad: false, contributedExtensionPoints: ['test/point'], definedExtensionPoints: [],
      dependencyWarnings: ['private dependency'],
      contributions: [{ id: 'entry', extensionPointId: 'test/point', source: 'extension-registration', status: 'quarantined', crashCount: 3, resourceKey: 'v1/Pod' }],
    };
    debug.pendingContributions['missing/point'] = [{ pluginId: 'test', contributionId: 'pending', extensionPointId: 'missing/point' }];
    debug.quarantinedContributions.push({ contributionId: 'entry', pluginId: 'test', extensionPointId: 'test/point', crashCount: 3, quarantinedAt: 123 });
    debug.recentCrashes.push({ contributionId: 'entry', pluginId: 'test', extensionPointId: 'test/point', boundary: 'ExtensionPointRenderer', errorMessage: 'private crash', stack: 'private stack', timestamp: 123 });
    registry.addExtensionPoint({ id: 'test/point' });
    registry.getExtensionPoint('test/point')!.register({ id: 'entry', plugin: 'test', label: 'Entry', value: () => null });
    const safe = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(safe.points[0].contributions[0]).toMatchObject({ crashCount: 3, status: 'quarantined', resourceKey: 'v1/Pod' });
    expect(safe.points.map(point => point.id)).not.toContain('missing/point');
    expect(safe.pending[0].status).toBe('pending-target');
    expect(new Set(safe.problems.map(problem => problem.kind))).toEqual(new Set(['pending-target', 'quarantined', 'render-error', 'plugin-error', 'dependency-warning']));
    expect(JSON.stringify(safe)).not.toMatch(/secret token|private crash|private stack|private dependency/);
    const sensitive = captureExtensionSnapshot(registry, service, { windowName: 'main', includeSensitive: true });
    expect(JSON.stringify(sensitive)).toContain('private stack');
    expect(filterExtensionSnapshot(safe, { pluginId: 'other', issuesOnly: true }).problems).toEqual([]);
    expect(filterExtensionSnapshot(safe, { pointId: 'missing/point', issuesOnly: true }).pending).toHaveLength(1);
  });

  it('counts captured crashes for registry-only contributions without leaking across point or plugin identities', () => {
    const { registry, service, debug } = fixture();
    for (const pointId of ['test/point', 'other/point']) {
      registry.addExtensionPoint({ id: pointId });
      registry.getExtensionPoint(pointId)!.register({ id: 'shared', plugin: 'test', label: 'Entry', value: null });
    }

    registry.getExtensionPoint('test/point')!.register({ id: 'shared-other', plugin: 'other', label: 'Other', value: null });
    debug.recentCrashes.push({ contributionId: 'shared', pluginId: 'test', extensionPointId: 'test/point', boundary: 'Renderer', errorMessage: 'private crash', timestamp: 123 });
    debug.recentCrashes.push({ contributionId: 'shared-other', pluginId: 'test', extensionPointId: 'test/point', boundary: 'Renderer', errorMessage: 'Unrelated plugin crash', timestamp: 123 });
    const captured = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(captured.points[0].contributions.map(entry => entry.crashCount)).toEqual([1, 0]);
    expect(captured.points[1].contributions[0].crashCount).toBe(0);
    debug.quarantinedContributions.push({ contributionId: 'shared', pluginId: 'test', extensionPointId: 'test/point', crashCount: 3, quarantinedAt: 124 });
    const quarantined = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(quarantined.points[0].contributions[0]).toMatchObject({ status: 'quarantined', crashCount: 3 });
    debug.recentCrashes = [];
    debug.quarantinedContributions = [];
    const recovered = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(recovered.points[0].contributions[0]).toMatchObject({ status: 'registered', crashCount: 0 });
  });

  it('bounds text and contribution count and marks truncation', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint({ id: 'test/point' });
    const point = registry.getExtensionPoint('test/point')!;
    for (let index = 0; index < 2100; index++) {
      point.register({ id: `entry-${index}`, plugin: 'test', label: 'x'.repeat(4000), value: null });
    }

    const snapshot = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.points[0].contributions.length).toBeLessThan(2000);
    expect(snapshot.points[0].contributions[0].label.length).toBe(2048);
    expect(JSON.stringify(snapshot).length).toBeLessThan(1_000_000);
  });

  it('joins equal contribution IDs only within the full point/plugin identity', () => {
    const { registry, service, debug } = fixture();
    debug.plugins.test = {
      id: 'test', phase: 'ready', backendPhase: null, error: null, retryCount: 0, loadedAt: 123,
      isDev: false, devPort: null, pluginWindow: null, validationErrors: [], moduleHash: null,
      inflightLoad: false, contributedExtensionPoints: ['test/point'], definedExtensionPoints: [], dependencyWarnings: [],
      contributions: [{ id: 'shared', extensionPointId: 'test/point', source: 'legacy-sidebar', status: 'quarantined', crashCount: 3, resourceKey: 'secret/Resource' }],
    };
    debug.quarantinedContributions.push({ contributionId: 'shared', pluginId: 'test', extensionPointId: 'test/point', crashCount: 3, quarantinedAt: 123 });
    registry.addExtensionPoint({ id: 'test/point' });
    registry.addExtensionPoint(createResourceSidebarExtensionPoint());
    registry.getExtensionPoint('test/point')!.register({ id: 'shared', plugin: 'test', label: 'Quarantined', value: null });
    registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.register({ id: 'shared', plugin: 'other', label: 'Unaffected', value: null, meta: { pluginId: 'other', resourceKey: 'v1/Pod' } });
    const snapshot = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(snapshot.points[0].owner).toBe('unknown');
    expect(snapshot.points[0].contributions[0]).toMatchObject({ status: 'quarantined', crashCount: 3, source: 'legacy-sidebar', resourceKey: 'secret/Resource' });
    expect(snapshot.points[1].contributions[0]).toMatchObject({ status: 'registered', crashCount: 0, source: 'registry' });
    expect(snapshot.points[1].contributions[0].resourceKey).toBeUndefined();
    expect(filterExtensionSnapshot(snapshot, { issuesOnly: true }).points.map(point => point.id)).toEqual(['test/point']);
    expect(lookupExtensionContext(registry, service, { pointId: RESOURCE_SIDEBAR_EXTENSION_POINT_ID, pluginId: 'other', resourceKey: 'v1/Pod' }, 'main').selected[0].quarantined).toBe(false);
    expect(() => {
      recoverExtensionContribution(registry, service, 'shared', snapshot); 
    }).toThrow('unambiguous contribution ID');
    expect(service.unquarantine).not.toHaveBeenCalled();
    registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.unregister('shared');
    registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.register({ id: 'shared', plugin: 'test', label: 'Same plugin, other point', value: null });
    const samePlugin = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    expect(samePlugin.points[1].contributions[0]).toMatchObject({ status: 'registered', crashCount: 0, source: 'registry' });
    expect(filterExtensionSnapshot(samePlugin, { issuesOnly: true }).points.map(point => point.id)).toEqual(['test/point']);
    registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.unregister('shared');
    const current = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    recoverExtensionContribution(registry, service, 'shared', current);
    expect(service.unquarantine).toHaveBeenCalledOnce();
    expect(service.unquarantine).toHaveBeenCalledWith('shared');
  });

  it('rejects stale selections after same-ID registration replacement', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint({ id: 'test/point' });
    const point = registry.getExtensionPoint('test/point')!;
    point.register({ id: 'entry', plugin: 'test', label: 'Old', value: null });
    const snapshot = captureExtensionSnapshot(registry, service, { windowName: 'main' });
    const filtered = filterExtensionSnapshot(snapshot, { query: 'old' });
    expect(() => {
      assertDiagnosticSnapshotCurrent(filtered); 
    }).not.toThrow();
    point.unregister('entry');
    point.register({ id: 'entry', plugin: 'test', label: 'New', value: null });
    expect(() => {
      assertDiagnosticSnapshotCurrent(filtered); 
    }).toThrow('selection changed');
  });
});

describe('explicit resource lookup', () => {
  it('uses real structured context and observes changes without stale matcher caches', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint(createResourceSidebarExtensionPoint());
    const point = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    const meta = { pluginId: 'test', resourceKey: 'v1/Pod' };
    point.register({ id: 'entry', plugin: 'test', label: 'Entry', value: null, meta });
    const request = { pointId: RESOURCE_SIDEBAR_EXTENSION_POINT_ID, pluginId: 'test', resourceKey: 'v1/Pod' };
    expect(lookupExtensionContext(registry, service, request, 'main').selected[0].id).toBe('entry');
    meta.resourceKey = 'v1/Node';
    expect(lookupExtensionContext(registry, service, request, 'main').selected).toEqual([]);
    expect(() => lookupExtensionContext(registry, service, { ...request, pointId: 'other/point' }, 'main')).toThrow('only builtin');
  });

  it('redacts thrown matcher errors', () => {
    const { registry, service } = fixture();
    registry.addExtensionPoint({ id: RESOURCE_SIDEBAR_EXTENSION_POINT_ID, matcher: () => {
      throw new Error('private matcher secret'); 
    } });
    registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!.register({ id: 'entry', plugin: 'test', label: 'Entry', value: null });
    expect(() => lookupExtensionContext(registry, service, { pointId: RESOURCE_SIDEBAR_EXTENSION_POINT_ID, pluginId: 'test', resourceKey: 'v1/Pod' }, 'main')).toThrow('Exception details are redacted');
  });
});
