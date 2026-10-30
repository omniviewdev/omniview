import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WindowsModule from '@/features/windows';
import { createSingleTabState, getActiveTab, pagesReducer, type PagesState } from './pagesState';
import { WorkspaceController } from './workspaceController';
import { routeOfHash, syncWindowUrlWithActiveTab } from './windowUrlSync';

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

    window.location.hash = '#/settings?category=terminal';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(activePath(controller)).toBe('/settings?category=terminal');
    // The URL already shows the route; syncing back must not add another entry.
    expect(window.history.length).toBe(start + 1);
  });
});

describe('routeOfHash', () => {
  it('reads the route of a window URL hash', () => {
    expect(routeOfHash('#/plugins')).toBe('/plugins');
    expect(routeOfHash('')).toBeNull();
    expect(routeOfHash('#section')).toBeNull();
  });
});
