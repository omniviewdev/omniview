import type { ExtensionContributionRegistration, ScopeConstraint } from '@omniviewdev/runtime';
import type {
  AvailabilityV1,
  GlobalSearchContributionV1,
  SearchEntryV1,
  SearchProviderItemV1,
  SearchProviderResponseV1,
  SearchProviderV1,
  SettingTargetV1,
  SearchScopeV1,
} from './types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim().length > 0;
}

function opaqueIdentifier(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim().length > 0;
}

function component(value: unknown): boolean {
  if (typeof value === 'function') {
    return true;
  }

  return record(value) && [Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')].includes(value.$$typeof as symbol);
}

export function isSearchQueryAllowed(query: string): boolean {
  if (query.length > 512) {
    return false;
  }

  let count = 0;
  for (let offset = 0; offset < query.length; ) {
    offset += query.codePointAt(offset)! > 0xffff ? 2 : 1;
    if (++count > 256) {
      return false;
    }
  }

  return true;
}

export function getNavigationHref(target: unknown): string | undefined {
  if (!record(target)) {
    return undefined;
  }

  if (target.kind === 'core') {
    return target.path === '/' || target.path === '/plugins' ? target.path : undefined;
  }

  if (target.kind !== 'plugin' || !identifier(target.pluginId) || typeof target.path !== 'string') {
    return undefined;
  }

  const path = target.path;
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname.length === 0 || pathname.length > 2048 || path.length - pathname.length > 8192 || !path.startsWith('/') || path.startsWith('//')) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
    return undefined;
  }

  // Split URI delimiters before decoding: an encoded '?' or '#' is still a
  // path segment and cannot hide a following traversal.
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }

  try {
    return `/_plugin/${encodeURIComponent(target.pluginId)}${path}`;
  } catch {
    return undefined;
  }
}

function admitRoute(input: unknown) {
  return record(input) && identifier(input.connection) ? { connection: input.connection } : undefined;
}

function admitReference(input: unknown) {
  if (!record(input) || !record(input.address)) {
    return undefined;
  }

  const address = input.address;
  if (!identifier(address.provider) || !opaqueIdentifier(address.authority, 4096)
    || !opaqueIdentifier(address.type, 512) || !opaqueIdentifier(address.id, 4096)
    || !Array.isArray(address.scope) || address.scope.length > 256
    || (input.incarnation !== undefined && !opaqueIdentifier(input.incarnation, 4096))) {
    return undefined;
  }

  const scope: Array<{ dimension: string; value: string }> = [];
  for (const entry of address.scope) {
    if (!record(entry) || !identifier(entry.dimension) || typeof entry.value !== 'string'
      || entry.value.length > 1024 || scope.some(other => other.dimension === entry.dimension)) {
      return undefined;
    }

    scope.push({ dimension: entry.dimension, value: entry.value });
  }

  return {
    address: { provider: address.provider, authority: address.authority, type: address.type, id: address.id, scope },
    ...(input.incarnation !== undefined ? { incarnation: input.incarnation } : {}),
  };
}

export function admitSearchScope(input: unknown): SearchScopeV1 | undefined {
  if (!record(input) || !identifier(input.pluginId) || !identifier(input.label)) {
    return undefined;
  }

  const common = { pluginId: input.pluginId, label: input.label };
  if (input.kind === 'connection') {
    return identifier(input.connectionId) ? { ...common, kind: 'connection', connectionId: input.connectionId } : undefined;
  }

  if (!opaqueIdentifier(input.targetId, 8192)
    || (input.scopeLabel !== undefined && !identifier(input.scopeLabel))) {
    return undefined;
  }

  const scoped = { ...common, targetId: input.targetId, ...(input.scopeLabel ? { scopeLabel: input.scopeLabel } : {}) };
  if (input.kind === 'resource') {
    const reference = admitReference(input.reference);
    const route = admitRoute(input.route);
    return reference && route && identifier(input.representation)
      ? { ...scoped, kind: 'resource', reference, route, representation: input.representation } : undefined;
  }

  if (input.kind !== 'resource-type' || !record(input.target)) {
    return undefined;
  }

  const target = input.target;
  const route = admitRoute(target.route);
  if (!route || !identifier(target.provider) || !opaqueIdentifier(target.authority, 4096)
    || !opaqueIdentifier(target.type, 512) || !identifier(target.representation)
    || !Array.isArray(target.scope) || target.scope.length > 256) {
    return undefined;
  }

  const scope: ScopeConstraint[] = [];
  for (const constraint of target.scope) {
    if (!record(constraint) || !identifier(constraint.dimension)
      || scope.some(other => other.dimension === constraint.dimension)) {
      return undefined;
    }

    if (constraint.match === 'any') {
      scope.push({ dimension: constraint.dimension, match: 'any' });
    } else if (constraint.match === 'oneOf' && Array.isArray(constraint.values)
      && constraint.values.length <= 256
      && constraint.values.every(value => typeof value === 'string' && value.length <= 1024)) {
      scope.push({ dimension: constraint.dimension, match: 'oneOf', values: [...constraint.values] });
    } else {
      return undefined;
    }
  }

  return { ...scoped, kind: 'resource-type', target: {
    route, provider: target.provider, authority: target.authority, type: target.type,
    representation: target.representation, scope,
  } };
}

export function admitSearchEntry(input: unknown): SearchEntryV1 | undefined {
  if (!record(input) || input.schemaVersion !== 1) {
    return undefined;
  }

  const description = input.description;
  if (description !== undefined && (typeof description !== 'string' || description.length > 1024)) {
    return undefined;
  }

  const rawKeywords = input.keywords;
  let keywords: string[] | undefined;
  if (rawKeywords !== undefined) {
    if (!Array.isArray(rawKeywords)) {
      return undefined;
    }

    const keywordsLength = rawKeywords.length;
    if (keywordsLength > 16) {
      return undefined;
    }

    keywords = [];
    for (let index = 0; index < keywordsLength; index++) {
      const keyword: unknown = rawKeywords[index];
      if (typeof keyword !== 'string' || keyword.length > 128) {
        return undefined;
      }

      keywords.push(keyword);
    }
  }

  let availability: AvailabilityV1 | undefined;
  if (input.availability !== undefined) {
    if (!record(input.availability)) {
      return undefined;
    }

    if (input.availability.state === 'enabled') {
      availability = { state: 'enabled' };
    } else if (
      input.availability.state === 'disabled' &&
      typeof input.availability.reason === 'string' &&
      input.availability.reason.length > 0 &&
      input.availability.reason.length <= 1024
    ) {
      availability = { state: 'disabled', reason: input.availability.reason };
    } else {
      return undefined;
    }
  }

  const scope = input.scope === undefined ? undefined : admitSearchScope(input.scope);
  if (input.scope !== undefined && !scope) {
    return undefined;
  }

  const common = {
    schemaVersion: 1 as const,
    ...(description !== undefined ? { description } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(availability ? { availability } : {}),
    ...(scope ? { scope } : {}),
  };
  if (input.kind === 'action') {
    if (!record(input.action) || !identifier(input.action.id) || !input.action.id.includes(':')) {
      return undefined;
    }

    const target = admitSearchScope(input.action.target);
    if (!target || (input.action.recovery !== undefined && (input.action.recovery !== 'connection' || target.kind !== 'connection'))) {
      return undefined;
    }

    if (input.action.query !== undefined && (typeof input.action.query !== 'string' || !isSearchQueryAllowed(input.action.query))) {
      return undefined;
    }

    return { ...common, kind: 'action', action: { id: input.action.id, target, ...(input.action.recovery === 'connection' ? { recovery: 'connection' as const } : {}), ...(input.action.query !== undefined ? { query: input.action.query } : {}) } };
  }

  if (input.kind === 'command') {
    if (!record(input.command) || input.command.kind !== 'reload-connections' || !identifier(input.command.pluginId)) {
      return undefined;
    }

    return { ...common, kind: 'command', command: { kind: 'reload-connections', pluginId: input.command.pluginId } };
  }

  if (input.kind === 'navigation') {
    if (!record(input.target) || getNavigationHref(input.target) === undefined) {
      return undefined;
    }

    if (input.target.kind === 'core' && (input.target.path === '/' || input.target.path === '/plugins')) {
      return { ...common, kind: 'navigation', target: { kind: 'core', path: input.target.path } };
    }

    if (
      input.target.kind === 'plugin' &&
      typeof input.target.pluginId === 'string' &&
      typeof input.target.path === 'string'
    ) {
      return {
        ...common,
        kind: 'navigation',
        target: { kind: 'plugin', pluginId: input.target.pluginId, path: input.target.path },
      };
    }

    return undefined;
  }

  if (input.kind !== 'setting' || !record(input.target)) {
    return undefined;
  }

  if (input.target.settingId !== undefined && !identifier(input.target.settingId)) {
    return undefined;
  }

  const setting = input.target.settingId === undefined ? {} : { settingId: input.target.settingId };
  let target: SettingTargetV1;
  if (input.target.section === 'core' && identifier(input.target.categoryId)) {
    target = { section: 'core', categoryId: input.target.categoryId, ...setting };
  } else if (input.target.section === 'plugins' && identifier(input.target.pluginId)) {
    target = { section: 'plugins', pluginId: input.target.pluginId, ...setting };
  } else if (input.target.section === 'extensions' && input.target.settingId === undefined) {
    target = { section: 'extensions' };
  } else {
    return undefined;
  }

  return { ...common, kind: 'setting', target };
}

export function admitSearchContribution(
  input: ExtensionContributionRegistration,
): GlobalSearchContributionV1 | undefined {
  if (!identifier(input.id) || !identifier(input.plugin) || !identifier(input.label)) {
    return undefined;
  }

  const value = input.value;
  if (record(value) && value.schemaVersion === 1 && value.kind === 'provider') {
    if (typeof value.search !== 'function') {
      return undefined;
    }

    if ((value.executeAction !== undefined && typeof value.executeAction !== 'function') || (value.validateAction !== undefined && typeof value.validateAction !== 'function')) {
      return undefined;
    }

    if (value.connectionTarget !== undefined && typeof value.connectionTarget !== 'function') {
      return undefined;
    }

    if (value.supportsScope !== undefined && typeof value.supportsScope !== 'function') {
      return undefined;
    }

    if (value.validateResource !== undefined && typeof value.validateResource !== 'function') {
      return undefined;
    }

    if (value.connectionRecovery !== undefined && value.connectionRecovery !== 'host' && value.connectionRecovery !== 'provider') {
      return undefined;
    }

    if (value.Context !== undefined && !component(value.Context)) {
      return undefined;
    }

    return { schemaVersion: 1, kind: 'provider', search: value.search as SearchProviderV1['search'],
      ...(value.executeAction ? { executeAction: value.executeAction as SearchProviderV1['executeAction'] } : {}),
      ...(value.validateAction ? { validateAction: value.validateAction as SearchProviderV1['validateAction'] } : {}),
      ...(value.connectionTarget ? { connectionTarget: value.connectionTarget as SearchProviderV1['connectionTarget'] } : {}),
      ...(value.supportsScope ? { supportsScope: value.supportsScope as SearchProviderV1['supportsScope'] } : {}),
      ...(value.validateResource ? { validateResource: value.validateResource as SearchProviderV1['validateResource'] } : {}),
      ...(value.connectionRecovery ? { connectionRecovery: value.connectionRecovery as SearchProviderV1['connectionRecovery'] } : {}),
      ...(value.Context !== undefined ? { Context: value.Context as SearchProviderV1['Context'] } : {}) };
  }

  const entry = admitSearchEntry(value);
  return entry?.kind === 'action' ? undefined : entry;
}

export function admitProviderResponse(input: unknown): SearchProviderResponseV1 | undefined {
  if (
    !record(input) ||
    !Array.isArray(input.items) ||
    (input.completion !== 'complete' && input.completion !== 'truncated')
  ) {
    return undefined;
  }

  const statuses = ['ready', 'disconnected', 'connecting', 'authentication-required', 'forbidden', 'unavailable', 'partial'] as const;
  if (input.status !== undefined && !statuses.includes(input.status as typeof statuses[number])) {
    return undefined;
  }

  if (input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 1024)) {
    return undefined;
  }

  const items: SearchProviderItemV1[] = [];
  const seen = new Set<string>();
  const length = Math.min(input.items.length, 20);
  for (let index = 0; index < length; index++) {
    const item: unknown = input.items[index];
    if (!record(item) || !opaqueIdentifier(item.id, 8192) || !identifier(item.label) || seen.has(item.id)) {
      return undefined;
    }

    const value = admitSearchEntry(item.value);
    if (!value) {
      return undefined;
    }

    seen.add(item.id);
    items.push({ id: item.id, label: item.label, value });
  }

  return { items, completion: input.items.length > 20 ? 'truncated' : input.completion,
    ...(input.status ? { status: input.status as SearchProviderResponseV1['status'] } : {}),
    ...(input.message ? { message: input.message } : {}) };
}
