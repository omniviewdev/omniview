import { describe, expect, it, vi } from 'vitest';
import { PageTabRouters } from './tabRouters';
import { openSettings } from '@omniviewdev/runtime';
import type * as RuntimeModule from '@omniviewdev/runtime';

vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  openSettings: vi.fn().mockResolvedValue('settings'),
}));

describe('PageTabRouters', () => {
  it('keeps navigation working for callers that captured the router before the routes changed', async () => {
    const onPathChange = vi.fn();
    const routers = new PageTabRouters([{ path: '/plugins' }, { path: '/plugins/:id' }], onPathChange);
    routers.ensure('tab', '/plugins/alpha');
    // useNavigate keeps the router it rendered with and calls router.navigate later.
    const routerBeforeRouteChange = routers.get('tab')!;

    // A plugin uninstall changes the route tree while the details page still
    // holds the navigate it rendered with.
    routers.setRoutes([{ path: '/plugins' }, { path: '/plugins/:id' }, { path: '/settings' }]);
    await routerBeforeRouteChange.navigate('/plugins');

    expect(routers.get('tab')!.state.location.pathname).toBe('/plugins');
    expect(onPathChange).toHaveBeenLastCalledWith('tab', '/plugins');
  });

  it('keeps the page location and history intact when an in-page link opens Settings', async () => {
    const routers = new PageTabRouters([{ path: '/plugins' }, { path: '/plugins/:id' }], vi.fn());
    routers.ensure('tab', '/plugins/alpha');
    const router = routers.get('tab')!;
    const before = router.state.location;

    await router.navigate('/settings?section=core&category=terminal');
    expect(router.state.location).toBe(before);
    expect(openSettings).toHaveBeenCalledWith('/settings?section=core&category=terminal');

    await router.navigate('/plugins');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/plugins/alpha');
  });

  it('does not treat look-alike page paths as Settings', async () => {
    const routers = new PageTabRouters([{ path: '/plugins' }, { path: '/settings-backup' }], vi.fn());
    routers.ensure('tab', '/plugins');
    const router = routers.get('tab')!;
    await router.navigate('/settings-backup');
    expect(router.state.location.pathname).toBe('/settings-backup');
  });
});
