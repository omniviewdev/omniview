import type { ExtensionAuthority } from './extensionAuthority';
import { ownData, type DetailOrigin, type DetailScope } from './detailScope';

export type DetailSelect = (stillAllowed?: () => boolean) => boolean;
type Destination = { readonly scope: DetailScope; readonly resolve: (point: string, offer: string) => DetailSelect | undefined };
// One currently displayed detail strip per window. No retained intents, data or fallback navigation.
const strips = new WeakMap<ExtensionAuthority, Destination>();
const observers = new WeakMap<ExtensionAuthority, Set<() => void>>();

/** A terminal follows this only while its menu names detail destinations. An unrelated owner render is not a menu revision. */
export function subscribeDetailTarget(authority: ExtensionAuthority, notify: () => void): () => void {
  const listeners = observers.get(authority) ?? new Set<() => void>();
  observers.set(authority, listeners);
  let previous = strips.get(authority);
  let queued = false;
  const changed = () => {
    if (queued) {
      return;
    }

    queued = true;
    // React cleans up the previous lease before publishing the committed strip. Never notify a temporary vacancy.
    queueMicrotask(() => {
      queued = false;
      if (!listeners.has(changed)) {
        return;
      }

      const next = strips.get(authority);
      if (previous?.scope === next?.scope && previous?.resolve === next?.resolve) {
        return;
      }

      previous = next;
      notify();
    });
  };

  listeners.add(changed);
  return () => {
    listeners.delete(changed);
    if (!listeners.size && observers.get(authority) === listeners) {
      observers.delete(authority);
    }
  };
}

function changed(authority: ExtensionAuthority): void {
  observers.get(authority)?.forEach(notify => {
    notify();
  });
}

export function attachDetailTarget(target: Destination): () => void {
  const { authority } = target.scope;
  strips.set(authority, target);
  changed(authority);
  return () => {
    if (strips.get(authority) !== target) {
      return;
    }

    strips.delete(authority);
    changed(authority);
  };
}

/** A terminal/menu supplies its verified origin, never the title of a tab or the foreground page's facts. */
export function detailMenuTarget(authority: ExtensionAuthority, origin: DetailOrigin, point: string, offer: string): DetailSelect | undefined {
  const target = strips.get(authority);
  if (!target) {
    return undefined;
  }

  const { scope } = target;
  if (!scope.current() || origin.owner !== scope.owner || origin.connection !== scope.connection ||
      origin.extensionScopeKey !== scope.extensionScopeKey || origin.route.page !== scope.route.page) {
    return undefined;
  }

  const { params } = scope.route;
  const incoming = origin.route.params;
  // A launch can retain additional private selectors. Never copy them into this page's route, or guess from its name alone.
  const matches = (key: string) => key === 'connection' || params[key] === ownData(incoming, key);
  if (!matches(scope.identity.name) || scope.identity.facets?.some(key => !matches(key))) {
    return undefined;
  }

  // The capture validates the exact binding and placement again when the source menu dispatches.
  const select = target.resolve(point, offer);
  return select && (stillAllowed => strips.get(authority)?.scope === scope && scope.current() && select(stillAllowed));
}
