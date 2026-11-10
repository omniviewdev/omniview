import type { ResourceMetricTarget } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';

const identities = new WeakMap<ResourceMetricTarget, string>();

/**
 * Canonical admitted identity of a target: route, address, scope set and incarnation, never the
 * caller's token. A target is immutable admitted identity, so each target object is serialized
 * once and every later comparison, sort and lookup reuses that string.
 */
export function targetIdentity(target: ResourceMetricTarget): string {
  let identity = identities.get(target);
  if (identity === undefined) {
    const address = target.reference.address;
    identity = JSON.stringify([target.route.connection, address.provider, address.authority, address.type,
      [...(address.scope ?? [])].map(scope => [scope.dimension, scope.value]).sort(([a], [b]) => a.localeCompare(b)),
      address.id, target.reference.incarnation ?? null]);
    identities.set(target, identity);
  }
  return identity;
}
