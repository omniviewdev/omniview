import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type {
  AvailabilityV1,
  GlobalSearchContributionV1,
  SearchEntryV1,
  SearchProviderItemV1,
  SearchProviderResponseV1,
  SearchProviderV1,
  SettingTargetV1,
} from './types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim().length > 0;
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
  if (path.length === 0 || path.length > 2048 || !path.startsWith('/') || path.startsWith('//')) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path.split(/[?#]/, 1)[0]);
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

  const common = {
    schemaVersion: 1 as const,
    ...(description !== undefined ? { description } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(availability ? { availability } : {}),
  };
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

    return { schemaVersion: 1, kind: 'provider', search: value.search as SearchProviderV1['search'] };
  }

  return admitSearchEntry(value);
}

export function admitProviderResponse(input: unknown): SearchProviderResponseV1 | undefined {
  if (
    !record(input) ||
    !Array.isArray(input.items) ||
    (input.completion !== 'complete' && input.completion !== 'truncated')
  ) {
    return undefined;
  }

  const items: SearchProviderItemV1[] = [];
  const seen = new Set<string>();
  const length = Math.min(input.items.length, 20);
  for (let index = 0; index < length; index++) {
    const item: unknown = input.items[index];
    if (!record(item) || !identifier(item.id) || !identifier(item.label) || seen.has(item.id)) {
      return undefined;
    }

    const value = admitSearchEntry(item.value);
    if (!value) {
      return undefined;
    }

    seen.add(item.id);
    items.push({ id: item.id, label: item.label, value });
  }

  return { items, completion: input.items.length > 20 ? 'truncated' : input.completion };
}
