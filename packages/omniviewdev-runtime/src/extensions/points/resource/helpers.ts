
/**
 * A resource parts object for matching a resource key.
 */
type ResourceParts = {
  /** The group the resource belongs to */
  group: string | string[];
  /** The version of the resource */
  version: string | string[];
  /** The kind of the resource */
  kind: string | string[];
};

/**
* Check if a resource matches the given parts.
* @param extensionId The extension ID to cache the result for
* @param resource The resource to check
* @param parts The parts to match
*/
export const matchesResource = (cache: Map<string, boolean>, extensionId: string, resource: string, matcher: string | string[] | RegExp | ResourceParts): boolean => {
  const cached = cache.get(`${extensionId}/${resource}`);
  if (cached !== undefined) {
    return cached;
  }

  if (typeof matcher === 'string') {
    const result = resource === matcher || matcher === '*';
    cache.set(`${extensionId}/${resource}`, result);
    return result;
  }

  if (matcher instanceof RegExp) {
    const result = matcher.test(resource);
    cache.set(`${extensionId}/${resource}`, result);
    return result;
  }

  if (Array.isArray(matcher)) {
    const result = matcher.some((m) => resource === m || m === '*');
    cache.set(`${extensionId}/${resource}`, result);
    return result;
  }

  const resourceParts = resource.split('::');

  const group = resourceParts[0] || ''
  const version = resourceParts[1] || ''
  const kind = resourceParts[2] || ''

  if (Array.isArray(matcher.group)) {
    if (!matcher.group.includes(group)) {
      cache.set(`${extensionId}/${resource}`, false);
      return false;
    }
  } else if (matcher.group !== group) {
    cache.set(`${extensionId}/${resource}`, false);
    return false;
  }

  if (Array.isArray(matcher.version)) {
    if (!matcher.version.includes(version)) {
      cache.set(`${extensionId}/${resource}`, false);
      return false;
    }
  } else if (matcher.version !== version) {
    cache.set(`${extensionId}/${resource}`, false);
    return false;
  }

  if (Array.isArray(matcher.kind)) {
    if (!matcher.kind.includes(kind)) {
      cache.set(`${extensionId}/${resource}`, false);
      return false;
    }
  } else if (matcher.kind !== kind) {
    cache.set(`${extensionId}/${resource}`, false);
    return false;
  }

  cache.set(`${extensionId}/${resource}`, true);
  return true;
};
