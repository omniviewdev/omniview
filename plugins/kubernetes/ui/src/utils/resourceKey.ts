/**
 * Pure utility functions for parsing and formatting resource keys.
 * Resource keys follow the format "group::version::Kind" (e.g. "core::v1::Pod").
 */

/** Parse a resource key like "core::v1::Pod" into { group, version, kind } */
export const parseResourceKey = (key: string): { group: string; version: string; kind: string } => {
  const parts = key.split('::');
  if (parts.length === 1) {
    // Single part — it's just a kind with no group/version
    return { group: 'core', version: '', kind: parts[0] };
  }
  return {
    group: parts[0] || 'core',
    version: parts[1] || '',
    kind: parts[2] || parts[0],
  };
};

/** Pretty-print group name: "core" -> "Core", "apps" -> "Apps" */
export const formatGroup = (group: string): string => {
  if (!group || group === 'core') return 'Core';
  return group.charAt(0).toUpperCase() + group.slice(1);
};

/**
 * Convert a nav item ID (e.g. "core_v1_Pod") to an informer resource key (e.g. "core::v1::Pod").
 * Nav IDs always have exactly 3 underscore-separated segments: group_version_kind.
 */
export const toResourceKey = (navId: string): string => {
  const parts = navId.split('_');
  if (parts.length < 3) return navId;
  // Always take first part as group, second as version, rest as kind
  // This handles the standard 3-part case: "core_v1_Pod" -> "core::v1::Pod"
  const group = parts[0];
  const version = parts[1];
  const kind = parts.slice(2).join('_');
  return `${group}::${version}::${kind}`;
};
