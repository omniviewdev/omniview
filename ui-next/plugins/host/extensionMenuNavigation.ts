import { createContext, useLayoutEffect, useMemo, useState } from 'react';
import type { Route, TabId, TabsStore } from '../../shell';
import { navigationOrigin, sameRoute } from '../../shell/core/tabs';
import { detailMenuTarget } from './detailMenuTarget';
import { detailResourceParams, type DetailOrigin } from './detailScope';
import type { ExtensionAuthority, ExtensionBinding } from './extensionAuthority';
import type { ShellOrigin } from './resourceShells';
import type { OpenView } from './useViewNavigation';

/** Host-only. A menu names a sibling offer; it cannot supply a route, parameters or navigation callbacks. */
export type ExtensionMenuNavigation = {
  readonly canOpenSidebar: (menu: ExtensionBinding, connection: string | undefined) => boolean;
  readonly openSidebar: (menu: ExtensionBinding, connection: string | undefined, current: () => boolean) => boolean;
  readonly canOpenDetail: (menu: ExtensionBinding, origin: ShellOrigin) => boolean;
  readonly openDetail: (menu: ExtensionBinding, origin: ShellOrigin, current: () => boolean) => boolean;
  readonly onDetailReady: (tabId: TabId, origin: DetailOrigin | undefined) => void;
};

export const ExtensionMenuNavigationContext = createContext<ExtensionMenuNavigation | null>(null);

/** Resolve the exact admitted destination. Never use the first matching label or expose a contributor page. */
export function menuDestination(menu: ExtensionBinding, candidates: readonly ExtensionBinding[], placement: 'sidebar' | 'detail-tab'): ExtensionBinding | undefined {
  const declaration = menu.declaration;
  if (menu.placement !== 'context-menu' || declaration.kind !== 'menu' || declaration.action.kind !== 'openView') {
    return undefined;
  }

  const { point, offer } = declaration.action;
  const owner = menu.point.slice(0, menu.point.indexOf('/') + 1);
  const contributor = menu.offer.slice(0, menu.offer.indexOf('/') + 1);
  if (!point.startsWith(owner)) {
    return undefined;
  }

  return candidates.find(candidate => candidate.point === point && candidate.offer === `${contributor}${offer}` &&
    candidate.placement === placement && candidate.ownerPin === menu.ownerPin && candidate.ownerGeneration === menu.ownerGeneration &&
    candidate.contributorPin === menu.contributorPin && candidate.contributorGeneration === menu.contributorGeneration);
}

/** Only declared resource identity enters ordinary tab history. Terminal/container attributes stay with the terminal owner. */
function detailLocator(origin: ShellOrigin): { route: Route; detail: DetailOrigin } | undefined {
  const { entry, connection, extensionScopeKey } = origin;
  const { page, params } = origin.route;
  const definition = Object.hasOwn(entry.contribution.pages, page) ? entry.contribution.pages[page] : undefined;
  if (definition?.kind !== 'detail' || !origin.current() || !params) {
    return undefined;
  }

  const keys = detailResourceParams(definition.definition.identity, params);
  if (!keys) {
    return undefined;
  }

  return { detail: { owner: entry.id, connection, extensionScopeKey, route: { page, params: keys } },
    route: { plugin: entry.id, contribution: page, params: { ...keys, connection } } };
}

type Intent = {
  readonly tab: TabId;
  readonly visit: number;
  readonly detail: DetailOrigin;
  readonly binding: ExtensionBinding;
  readonly menu: ExtensionBinding;
  readonly current: () => boolean;
  readonly onRetire: ShellOrigin['onRetire'];
  readonly consume: () => boolean;
};

/** One window-local intent. It follows a successful guarded push, never a tab's saved data or Back/Forward history. */
export function useDetailMenuNavigation(tabs: TabsStore, authority: ExtensionAuthority | null, open: OpenView) {
  const [intent, setIntent] = useState<Intent>();
  useLayoutEffect(() => {
    if (!intent || !authority) {
      return;
    }

    const retire = () => {
      const state = tabs.getSnapshot();
      if (state.active !== intent.tab || state.activeVisit !== intent.visit || !intent.current()) {
        intent.consume();
        setIntent(previous => previous === intent ? undefined : previous);
      }
    };

    const stops = [tabs.subscribe(retire), authority.subscribePoint(intent.menu.point, retire), authority.subscribePoint(intent.binding.point, retire), intent.onRetire(retire)];
    retire();
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [authority, tabs, intent]);

  return useMemo<Pick<ExtensionMenuNavigation, 'canOpenDetail' | 'openDetail' | 'onDetailReady'>>(() => {
    function resolve(menu: ExtensionBinding, origin: ShellOrigin) {
      const declaration = menu.declaration;
      if (!authority || declaration.kind !== 'menu' || declaration.action.kind !== 'openView' ||
          !menu.point.startsWith(`${origin.entry.id}/`) || !authority.point(menu.point).includes(menu)) {
        return undefined;
      }

      const binding = menuDestination(menu, authority.point(declaration.action.point), 'detail-tab');
      const locator = binding && detailLocator(origin);
      const from = navigationOrigin(tabs.getSnapshot());
      if (!binding || !locator || !from.id || !from.location) {
        return undefined;
      }

      const select = detailMenuTarget(authority, locator.detail, binding.point, binding.offer);
      if (select) {
        return { binding, locator, from, select };
      }

      const here = from.location.route;
      if (here.kind === undefined && here.plugin === locator.route.plugin && here.contribution === locator.route.contribution &&
          (here.params.connection === undefined || here.params.connection === origin.connection) &&
          Object.entries(locator.detail.route.params).every(([key, value]) => here.params[key] === value)) {
        // Same locator does not prove same incarnation. Do not push the page again to force eligibility.
        return undefined;
      }

      return { binding, locator, from, select: undefined };
    }

    return {
      canOpenDetail: (menu, origin) => resolve(menu, origin) !== undefined,
      openDetail(menu, origin, current) {
        const found = current() ? resolve(menu, origin) : undefined;
        if (!authority || !found) {
          return false;
        }

        if (found.select) {
          return found.select(current);
        }

        const { binding, locator, from } = found;
        const valid = () => current() && origin.current() && authority.point(menu.point).includes(menu) && authority.point(binding.point).includes(binding);
        open(locator.route, 'here', 'menu', valid, from, () => {
          const arrived = navigationOrigin(tabs.getSnapshot());
          if (arrived.id && arrived.id === from.id && arrived.location && sameRoute(arrived.location.route, locator.route) && valid()) {
            let consumed = false;
            setIntent({
              tab: arrived.id, visit: arrived.visit, detail: locator.detail, menu, binding, current: valid, onRetire: origin.onRetire,
              consume: () => {
                if (consumed) {
                  return false;
                }

                consumed = true;
                return true;
              },
            });
          }
        });
        return true;
      },
      onDetailReady(tabId, detail) {
        if (intent?.tab !== tabId || !intent.consume()) {
          return;
        }

        setIntent(previous => previous === intent ? undefined : previous);
        const { binding } = intent;
        const state = tabs.getSnapshot();
        if (authority && state.active === tabId && state.activeVisit === intent.visit &&
            detail?.extensionScopeKey === intent.detail.extensionScopeKey && intent.current()) {
          detailMenuTarget(authority, intent.detail, binding.point, binding.offer)?.(intent.current);
        }
      },
    };
  }, [authority, intent, open, tabs]);
}
