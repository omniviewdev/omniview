import { matchRoutes, type RouteObject } from 'react-router';
import type { OpenGlobalSearchOptions, SearchRouteContextV1, SearchRouteHandleV1, SearchScopeV1 } from '@omniviewdev/runtime';
import { admitSearchScope } from './admission';
import { parsePagePath } from '@/features/workspace/pagePaths';

function protectRoutePercents(routes: RouteObject[]): RouteObject[] {
  return routes.map((route): RouteObject => {
    const path = route.path?.replaceAll('%', '%25');
    if (route.index) {
      return { ...route, path };
    }

    return {
      ...route, path,
      ...(route.children ? { children: protectRoutePercents(route.children) } : {}),
    };
  });
}

export function resolveRouteSearchScope(
  location: { pathname: string; search: string },
  routesForPlugin: (pluginId: string) => RouteObject[] | undefined,
  isPluginReady: (pluginId: string) => boolean,
): SearchScopeV1 | null | undefined {
  const hostPage = /^\/(?:resources|connections)\//.test(location.pathname) ? parsePagePath(location.pathname) : undefined;
  if (hostPage?.kind === 'connection' && isPluginReady(hostPage.pluginId)) {
    return { kind: 'connection', pluginId: hostPage.pluginId, connectionId: hostPage.connectionId, label: hostPage.connectionId };
  }

  const rawOwner = /^\/_plugin\/([^/]+)(?=\/|$)/.exec(location.pathname);
  if (!rawOwner) {
    return undefined;
  }

  try {
    const pluginId = decodeURIComponent(rawOwner[1]);
    if (!isPluginReady(pluginId)) {
      return undefined;
    }

    const routes = routesForPlugin(pluginId);
    if (!routes) {
      return undefined;
    }

    const pathname = location.pathname.slice(rawOwner[0].length) || '/';
    // React Router substitutes %2F after decoding, including a literal %2F
    // produced by %252F. Protect encoded percent signs for matching and undo
    // that protection once on params. Static route literals need the same
    // protection so percent, unicode and space paths retain normal matching.
    const protectPercent = /%25/i.test(pathname);
    const matches = matchRoutes(protectPercent ? protectRoutePercents(routes) : routes,
      protectPercent ? pathname.replace(/%25/gi, '%2525') : pathname);
    if (!matches) {
      return undefined;
    }

    const params = { ...matches[matches.length - 1].params };
    if (protectPercent) {
      for (const key of Object.keys(params)) {
        if (params[key] !== undefined) {
          params[key] = decodeURIComponent(params[key]);
        }
      }
    }

    const context: SearchRouteContextV1 = Object.freeze({
      pluginId, pathname, search: location.search,
      params: Object.freeze(params),
    });
    for (let index = matches.length - 1; index >= 0; index--) {
      try {
        const handle = matches[index].route.handle as SearchRouteHandleV1 | undefined;
        const value = typeof handle?.searchScope === 'function' ? handle.searchScope(context) : handle?.searchScope;
        if (value === null) {
          return null;
        }

        const scope = admitSearchScope(value);
        if (scope?.kind === 'connection' && scope.pluginId === pluginId) {
          return scope;
        }
      } catch {
        // A broken child contribution must not suppress a valid ancestor.
      }
    }
  } catch {
    // Invalid plugin route trees cannot prevent opening global search.
  }

  return undefined;
}

/** Seed context only for a new session; removed scopes stay removed until reopening. */
export function resolveSearchOpenOptions(
  options: OpenGlobalSearchOptions,
  isOpen: boolean,
  activeScope: () => SearchScopeV1 | null | undefined,
): OpenGlobalSearchOptions {
  if (isOpen || options.scope !== undefined) {
    return options;
  }

  const scope = activeScope();
  return scope === undefined ? options : { ...options, scope };
}
