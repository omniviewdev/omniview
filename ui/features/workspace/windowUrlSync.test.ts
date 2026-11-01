import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WindowsModule from '@/features/windows';
import { createSingleTabState, getActiveTab, pagesReducer, type PagesState } from './pagesState';
import { WorkspaceController } from './workspaceController';
import { routeOfHash, syncWindowUrlWithActiveTab } from './windowUrlSync';
import { openSettings } from '@omniviewdev/runtime';
import type * as RuntimeModule from '@omniviewdev/runtime';

vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  openSettings: vi.fn().mockResolvedValue('settings'),
}));

vi.mock('@/features/windows', async (importOriginal) => ({
  ...(await importOriginal<typeof WindowsModule>()),
  saveSlot: vi.fn(),
}));

/** Tabs `a` (active) and `b` in one pane, at `/a` and `/b`; no routers yet. */
function twoTabs(): PagesState {
  return pagesReducer(createSingleTabState({ id: 'a', path: '/a' }, 'p1'), {
    type: 'open', tab: { id: 'b', path: '/b' }, paneId: 'p1', afterTabId: 'a', activate: false,
  });
}

function activePath(controller: WorkspaceController): string | undefined {
  return getActiveTab(controller.getState())?.path;
}

describe('syncWindowUrlWithActiveTab', () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    stop();
  });

  it('opens a deep link in the active tab and shows the active route otherwise', () => {
    window.history.replaceState(null, '', '/#/plugins/alpha');
    const controller = new WorkspaceController(twoTabs(), []);
    stop = syncWindowUrlWithActiveTab(controller);

    expect(activePath(controller)).toBe('/plugins/alpha');
    expect(window.location.hash).toBe('#/plugins/alpha');
  });

  it('keeps the restored active tab when the window opens at the root route', () => {
    window.history.replaceState(null, '', '/#/');
    const controller = new WorkspaceController(twoTabs(), []);
    stop = syncWindowUrlWithActiveTab(controller);

    expect(activePath(controller)).toBe('/a');
    expect(window.location.hash).toBe('#/a');
  });

  it('adds a history entry for navigation inside a tab but not for switching tabs', () => {
    const controller = new WorkspaceController(twoTabs(), []);
    stop = syncWindowUrlWithActiveTab(controller);
    const start = window.history.length;

    controller.navigateActive('/a/detail');
    expect(window.location.hash).toBe('#/a/detail');
    expect(window.history.length).toBe(start + 1);

    controller.dispatch({ type: 'activate', tabId: 'b' });
    expect(window.location.hash).toBe('#/b');
    expect(window.history.length).toBe(start + 1);
  });

  it('navigates the active tab when the URL hash changes from outside', () => {
    const controller = new WorkspaceController(twoTabs(), []);
    stop = syncWindowUrlWithActiveTab(controller);
    const start = window.history.length;

    window.location.hash = '#/plugins/alpha';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(activePath(controller)).toBe('/plugins/alpha');
    expect(window.history.length).toBe(start + 1);
  });
  it('routes legacy settings hashes without replacing the workspace tab', () => {
    const controller = new WorkspaceController(twoTabs(), []);
    stop = syncWindowUrlWithActiveTab(controller);
    const before = controller.getState();
    window.location.hash = '#/settings?category=terminal';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(controller.getState()).toBe(before);
    expect(window.location.hash).toBe('#/a');
    expect(openSettings).toHaveBeenCalledWith('/settings?category=terminal');
  });

  it.each(['navigateActive', 'openInNewTab', 'openInSplit', 'openInNewWindow'] as const)(
    '%s opens Settings without changing panes, tabs, or workspace history',
    async (operation) => {
      const controller = new WorkspaceController(twoTabs(), []);
      stop = syncWindowUrlWithActiveTab(controller);
      const before = controller.getState();
      const history = window.history.length;
      await controller[operation]('/settings?category=appearance');
      expect(controller.getState()).toBe(before);
      expect(activePath(controller)).toBe('/a');
      expect(window.history.length).toBe(history);
    },
  );
});

describe('routeOfHash', () => {
  it('reads the route of a window URL hash', () => {
    expect(routeOfHash('#/plugins')).toBe('/plugins');
    expect(routeOfHash('')).toBeNull();
    expect(routeOfHash('#section')).toBeNull();
  });
});
