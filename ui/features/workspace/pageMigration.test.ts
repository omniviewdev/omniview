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
});
