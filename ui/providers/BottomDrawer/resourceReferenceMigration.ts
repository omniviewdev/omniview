import type { DrawerSlot, SerializedDrawerTab } from './drawerSlot';

export const unresolvedResourceReferenceMessage = 'A saved terminal resource reference cannot be restored safely. Open the resource again to start a new terminal. The original options are retained.';

function hasCanonicalReference(opts: Record<string, unknown>): boolean {
  const reference = opts.reference;
  const route = opts.route;
  if (typeof reference !== 'object' || reference === null || !('address' in reference)
    || typeof route !== 'object' || route === null || !('connection' in route)) {
    return false;
  }

  const address = reference.address;
  if (typeof address !== 'object' || address === null
    || !('provider' in address) || !('authority' in address) || !('type' in address)
    || !('id' in address) || !('scope' in address)) {
    return false;
  }

  if (![address.provider, address.authority, address.type, address.id, route.connection]
    .every(value => typeof value === 'string' && value.length > 0)) {
    return false;
  }

  if ('incarnation' in reference && reference.incarnation !== undefined && typeof reference.incarnation !== 'string') {
    return false;
  }

  if (!Array.isArray(address.scope)) {
    return false;
  }

  const dimensions = new Set<string>();
  for (const entry of address.scope) {
    if (typeof entry !== 'object' || entry === null || !('dimension' in entry) || !('value' in entry)
      || typeof entry.dimension !== 'string' || entry.dimension.length === 0
      || typeof entry.value !== 'string' || dimensions.has(entry.dimension)) {
      return false;
    }

    dimensions.add(entry.dimension);
  }

  return true;
}

export function savedResourceReferenceStatus(tab: Pick<SerializedDrawerTab, 'properties'>): 'converted' | 'unconvertible' | undefined {
  const migration = tab.properties?.resourceReferenceMigration;
  if (typeof migration !== 'object' || migration === null
    || !('version' in migration) || migration.version !== 1 || !('status' in migration)) {
    return undefined;
  }

  return migration.status === 'converted' || migration.status === 'unconvertible' ? migration.status : undefined;
}

export function hasUnresolvedResourceReference(tab: Pick<SerializedDrawerTab, 'properties'>): boolean {
  return savedResourceReferenceStatus(tab) === 'unconvertible';
}

/**
 * Legacy terminal selectors do not establish a host authority or a complete scope.
 * Preserve the original options once, but never replay them as a canonical reference.
 * A complete saved address can reuse the tab's explicit connection as its route.
 * Complete canonical options remain unchanged. No selector supplies identity.
 */
export function migrateDrawerResourceReferences(slot: DrawerSlot): DrawerSlot {
  if (slot.version === 2) {
    return slot;
  }

  let changed = false;
  const tabs = slot.tabs.map(tab => {
    const opts = tab.properties?.opts;
    if (tab.variant !== 'terminal' || savedResourceReferenceStatus(tab) !== undefined
      || typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
      return tab;
    }

    const options = opts as Record<string, unknown>;
    const resourceIntent = options.reference != null || (typeof options.resource_key === 'string' && options.resource_key !== '');
    if (!resourceIntent || hasCanonicalReference(options)) {
      return tab;
    }

    const connection = tab.properties?.connectionID;
    const withRoute = options.route == null && typeof connection === 'string' && connection !== ''
      ? { ...options, route: { connection } }
      : undefined;
    const converted = withRoute !== undefined && hasCanonicalReference(withRoute);
    changed = true;
    const { opts: originalOptions, resourceReferenceMigration: originalMigration, ...properties } = tab.properties!;
    return { ...tab, properties: {
      ...properties,
      ...(converted ? { opts: withRoute } : {}),
      resourceReferenceMigration: { version: 1, status: converted ? 'converted' : 'unconvertible', legacy: {
        opts: originalOptions,
        ...(originalMigration === undefined ? {} : { resourceReferenceMigration: originalMigration }),
      } },
    } };
  });
  return { ...slot, version: 2, tabs: changed ? tabs : slot.tabs };
}
