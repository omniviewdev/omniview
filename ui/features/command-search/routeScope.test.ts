import { describe, expect, it } from 'vitest';
import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import type { SearchRouteContextV1, SearchScopeV1 } from '@omniviewdev/runtime';
import type { RouteObject } from 'react-router';
import { normalizePluginRoutes } from '../plugins/react/normalizePluginRoutes';
import { createGlobalSearchController } from './controller';
import { resolveRouteSearchScope, resolveSearchOpenOptions } from './routeScope';
import { searchResource, searchType } from './searchFixtures';

const connection: SearchScopeV1 = { kind: 'connection', pluginId: 'provider', connectionId: 'west', label: 'west' };
const resource = { ...searchType('opaque/native/key'), pluginId: 'provider', label: 'Machines', target: { ...searchType('opaque/native/key').target, route: { connection: 'west' } } };
function harness() {
  let location = { pathname: '/_plugin/provider/accounts/west', search: '?tab=all' };
  let ready = true;
  let registered = true;
  let context: SearchRouteContextV1 | undefined;
  const routes: RouteObject[] = normalizePluginRoutes([{
    path: '/accounts/:account',
    handle: { searchScope: (input: SearchRouteContextV1) => {
      context = input;
      return { ...connection, connectionId: input.params.account };
    } },
    children: [
      { path: '/machines/:category', handle: { searchScope: resource } },
      { path: 'object', handle: { searchScope: { ...searchResource('opaque/native/key', 'machine-1', []), pluginId: 'provider', route: { connection: 'west' } } } },
      { path: 'dashboard' },
      { path: 'global', handle: { searchScope: null } },
      { path: 'throws', handle: { searchScope: () => {
        throw new Error('plugin failure'); 
      } } },
      { path: 'foreign', handle: { searchScope: { ...resource, pluginId: 'other' } } },
      { path: 'invalid', handle: { searchScope: { kind: 'resource-type' } } },
      { path: 'undefined', handle: { searchScope: () => undefined } },
      { path: 'mutation', handle: { searchScope: (input: SearchRouteContextV1) => {
        (input.params as Record<string, string>).account = 'corrupted';
        return resource;
      } } },
    ],
  }]);
  const resolve = () => resolveRouteSearchScope(location, (id) => id === 'provider' && registered ? routes : undefined, () => ready);
  const controller = createGlobalSearchController({ registry: new ExtensionPointRegistry(), isPluginReady: () => ready,
    hasPluginRoute: () => registered, listResourcePlugins: async () => [], loadConnections: async () => [], navigate: () => undefined,
    openNew: () => undefined });
  const open = (options = {}) => {
    controller.open(resolveSearchOpenOptions(options, controller.getSnapshot().isOpen, resolve)); 
  };

  return { controller, resolve, open, context: () => context,
    go: (suffix: string) => {
      location = { ...location, pathname: '/_plugin/provider/accounts/west' + suffix }; 
    },
    unload: () => {
      ready = false; 
    }, unregister: () => {
      registered = false; 
    } };
}

describe('registered route search context and opening', () => {
  it.each(['region/cluster', 'region%2Fcluster', 'region%2fcluster', 'region%25cluster', 'region%20cluster', 'region space/λ', '%'])('decodes connection ID exactly once: %s', (connectionId) => {
    const pathname = `/cluster/${encodeURIComponent(connectionId)}/resources`;
    let received: SearchRouteContextV1 | undefined;
    const routes: RouteObject[] = [{
      path: 'cluster/:id/resources',
      handle: { searchScope: (context: SearchRouteContextV1) => {
        received = context;
        return { ...connection, connectionId: context.params.id };
      } },
    }];
    expect(resolveRouteSearchScope({ pathname: '/_plugin/provider' + pathname, search: '' }, () => routes, () => true))
      .toEqual({ ...connection, connectionId });
    expect(received?.params.id).toBe(connectionId);
    expect(received?.pathname).toBe(pathname);
  });

  it.each(['percent%', 'literal%2F', 'two words', '東京', '100% 東京'])('preserves static route matching for %s beside encoded percent params', (page) => {
    const connectionId = 'context%2Fopaque';
    const pathname = `/cluster/${encodeURIComponent(connectionId)}/${encodeURIComponent(page)}`;
    const routes = normalizePluginRoutes([{
      path: '/cluster/:id',
      children: [{
        path: page,
        handle: { searchScope: (context: SearchRouteContextV1) => ({ ...connection, connectionId: context.params.id }) },
      }],
    }]);
    expect(resolveRouteSearchScope({ pathname: '/_plugin/provider' + pathname, search: '' }, () => routes, () => true))
      .toEqual({ ...connection, connectionId });
  });

  it('inherits only cluster context on dashboards, contributed pages, and resource tables', () => {
    const cluster = { ...connection, pluginId: 'kubernetes' };
    const routes = normalizePluginRoutes([{
      path: '/cluster/:id',
      children: [
        { path: 'edit', handle: { searchScope: cluster } },
        { path: 'resources', handle: { searchScope: cluster }, children: [
          { index: true },
          { path: 'metrics' },
          { path: 'page/:pagePath' },
          { path: 'core_v1_Pod' },
          { path: ':resourceKey' },
        ] },
      ],
    }]);
    for (const suffix of ['edit', 'resources', 'resources/metrics', 'resources/page/cost', 'resources/not-a-resource', 'resources/core_v1_Pod', 'resources/example.io_v1_Widget']) {
      expect(resolveRouteSearchScope({ pathname: '/_plugin/kubernetes/cluster/west/' + suffix, search: '' }, () => routes, () => true)).toEqual(cluster);
    }
  });

  it('ignores deeper generic provider route scopes and inherits the connection', () => {
    const h = harness();
    h.go('/machines/virtual');
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([connection]);
    h.controller.close();
    h.go('/dashboard');
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([connection]);
    expect(h.context()).toEqual({ pluginId: 'provider', params: { account: 'west' }, pathname: '/accounts/west/dashboard', search: '?tab=all' });
    expect(Object.isFrozen(h.context())).toBe(true);
    expect(Object.isFrozen(h.context()!.params)).toBe(true);
    h.controller.dispose();
  });

  it('does not seed deeper route scopes without a connection ancestor', () => {
    const routes: RouteObject[] = [{ path: 'machines', handle: { searchScope: resource } }];
    expect(resolveRouteSearchScope({ pathname: '/_plugin/provider/machines', search: '' }, () => routes, () => true))
      .toBeUndefined();
  });

  it.each(['object', 'throws', 'foreign', 'invalid', 'undefined', 'mutation'])('inherits connection after %s child context', (page) => {
    const h = harness();
    h.go('/' + page);
    expect(h.resolve()).toEqual(connection);
    h.controller.dispose();
  });

  it('honors null route and explicit overrides, including null while open', () => {
    const h = harness();
    h.go('/global');
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    h.open({ scope: resource });
    expect(h.controller.getSnapshot().scopes).toEqual([connection, resource]);
    const object = { ...searchResource(resource.target.type, 'machine-1', []), pluginId: 'provider', route: { connection: 'west' } };
    h.open({ scope: object });
    expect(h.controller.getSnapshot().scopes).toEqual([
      connection, object,
    ]);
    h.open({ scope: null });
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    h.controller.dispose();
  });

  it('reads navigation on each new session without reapplying removed chips', () => {
    const h = harness();
    h.open();
    h.controller.removeScope(0);
    h.go('/machines/virtual');
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    h.controller.close();
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([connection]);
    h.controller.dispose();
  });

  it.each(['unload', 'unregister'] as const)('does not seed retired plugin context after %s', (retire) => {
    const h = harness();
    h.go('/machines/virtual');
    h[retire]();
    h.open();
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    h.controller.dispose();
  });
});

it('seeds workspace resource scopes without parsing opaque type IDs or requiring plugin routes', () => {
  const location = { pathname: '/resources/provider/prod%2Fwest', search: '?type=native%2Fopaque%3A%3Atype' };
  expect(resolveRouteSearchScope(location, () => undefined, () => true))
    .toEqual({ kind: 'connection', pluginId: 'provider', connectionId: 'prod/west', label: 'prod/west' });
  expect(resolveRouteSearchScope(location, () => undefined, () => false)).toBeUndefined();
});
