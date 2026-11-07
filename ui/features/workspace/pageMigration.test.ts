import { describe, expect, it, vi } from 'vitest';
import type * as WindowsModule from '@/features/windows';
import { createSingleTabState, parsePagesState } from './pagesState';
import { WorkspaceController } from './workspaceController';
import { saveSlot } from '@/features/windows';

vi.mock('@/features/windows', async (original) => ({
  ...(await original<typeof WindowsModule>()),
  saveSlot: vi.fn(),
}));

describe('saved provider page migration', () => {
  it('saves the original and reloads the migrated page without another write', () => {
    const oldPath = '/_plugin/kubernetes/cluster/c/resources/core_v1_Pod';
    const newPath = '/_plugin/kubernetes/cluster/c/resources/k8s%3A%2Fpods';
    const migratePagePath = vi.fn((path: string) => path === oldPath
      ? { kind: 'migrated' as const, path: newPath }
      : { kind: 'unchanged' as const });
    const registrations = new Map([['kubernetes', { migratePagePath }]]);
    const controller = new WorkspaceController(createSingleTabState({ id: 'a', path: oldPath }, 'p'), []);
    controller.migrateRestoredPaths(registrations, vi.fn());
    expect(controller.getState().tabs.a).toMatchObject({ path: newPath, legacy: { path: oldPath } });
    const reloaded = parsePagesState(JSON.parse(JSON.stringify(controller.getState())));
    const next = new WorkspaceController(reloaded, []);
    vi.mocked(saveSlot).mockClear();
    next.migrateRestoredPaths(registrations, vi.fn());
    expect(next.getState()).toEqual(reloaded);
    expect(saveSlot).not.toHaveBeenCalled();
  });

  it('retains the first legacy path when a migrated tab opens in another window', () => {
    const legacy = { path: '/old' };
    const state = createSingleTabState({ id: 'a', path: '/new', legacy }, 'p');
    const reloaded = parsePagesState(JSON.parse(JSON.stringify(state)));
    expect(reloaded.tabs.a).toMatchObject({ path: '/new', legacy });
  });

  it('reports unresolved paths and retains the saved original', () => {
    const path = '/_plugin/kubernetes/cluster/c/resources/example_v1_Widget';
    const controller = new WorkspaceController(createSingleTabState({ id: 'a', path }, 'p'), []);
    const report = vi.fn();
    const registrations = new Map([['kubernetes', { migratePagePath: () => ({ kind: 'unconvertible' as const, reason: 'Unknown type' }) }]]);
    controller.migrateRestoredPaths(registrations, report);
    controller.migrateRestoredPaths(registrations, report);
    expect(controller.getState().tabs.a.path).toBe(path);
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(path, 'Unknown type');
  });
  it.each([null, 'bad', { path: 42 }, { path: 'relative' }])('retains and reports malformed legacy metadata: %s', (legacy) => {
    const path = '/_plugin/kubernetes/cluster/c/resources/old';
    const state = createSingleTabState({ id: 'a', path, legacy }, 'p');
    const restored = parsePagesState(JSON.parse(JSON.stringify(state)));
    const controller = new WorkspaceController(restored, []);
    const report = vi.fn();
    controller.migrateRestoredPaths(new Map(), report);
    controller.migrateRestoredPaths(new Map(), report);
    expect(controller.getState().tabs.a.legacy).toEqual(legacy);
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(path, 'The saved legacy page metadata is invalid.');
  });

  it('preserves malformed metadata when a provider migrates the tab', () => {
    const original = '/_plugin/kubernetes/cluster/c/resources/old';
    const controller = new WorkspaceController(createSingleTabState({ id: 'a', path: original, legacy: null }, 'p'), []);
    const report = vi.fn();
    const migratePagePath = () => ({ kind: 'migrated' as const, path: '/new' });
    controller.migrateRestoredPaths(new Map([['kubernetes', { migratePagePath }]]), report);
    const saved = JSON.parse(JSON.stringify(controller.getState()));
    expect(parsePagesState(saved).tabs.a).toMatchObject({
      path: '/new',
      legacy: { path: original, invalidMetadata: null },
    });
    expect(report).toHaveBeenCalledWith(original, 'The saved legacy page metadata is invalid.');
    const reloaded = new WorkspaceController(parsePagesState(saved), []);
    const reloadReport = vi.fn();
    reloaded.migrateRestoredPaths(new Map(), reloadReport);
    expect(reloadReport).toHaveBeenCalledWith('/new', 'The saved legacy page metadata is invalid.');
  });

  it.each(['/settings', '/settings/plugins?x=1', 'relative', '//example.com/path', '/\\example.com', null])(
    'rejects invalid provider result %s before changing state or navigating',
    (path) => {
      const original = '/_plugin/kubernetes/cluster/c/resources/old';
      const controller = new WorkspaceController(createSingleTabState({ id: 'a', path: original }, 'p'), [{ path: '*' }]);
      controller.routers.ensure('a', original);
      const router = controller.routers.get('a')!;
      const navigate = vi.spyOn(router, 'navigate');
      const report = vi.fn();
      const migratePagePath = vi.fn(() => ({ kind: 'migrated' as const, path: path! }));
      controller.migrateRestoredPaths(new Map([['kubernetes', { migratePagePath }]]), report);
      expect(controller.getState().tabs.a.path).toBe(original);
      expect(navigate).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledWith(original, 'The provider returned an invalid page path.');
    },
  );
});
