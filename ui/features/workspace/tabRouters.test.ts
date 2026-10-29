import { describe, expect, it, vi } from 'vitest';
import { PageTabRouters } from './tabRouters';

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

  it('renders links in the window URL form', () => {
    const routers = new PageTabRouters([{ path: '/settings' }], vi.fn());
    routers.ensure('tab', '/settings?category=terminal');
    const router = routers.get('tab')!;

    expect(router.createHref(router.state.location)).toBe('#/settings?category=terminal');
  });
});
