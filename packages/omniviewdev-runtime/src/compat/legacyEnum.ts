/**
 * The Wails v2 bindings named enum members after the string labels declared in
 * the Go `All<Enum>s` tables (`SYNCED`, `BAD_REQUEST`), while the v3 bindings
 * use the Go constant identifiers (`WatchStateSynced`,
 * `ConnectionStatusBadRequest`). The underlying values are unchanged.
 *
 * Plugins are compiled against the published runtime and still reference the
 * old names, so the host hands them enums carrying both spellings.
 */
export function withLegacyNames<T extends Record<string, string | number>>(
  generated: T,
  prefix: string,
): T {
  const aliased: Record<string, unknown> = { ...generated };

  for (const [name, value] of Object.entries(generated)) {
    if (name === '$zero' || !name.startsWith(prefix)) {
      continue;
    }

    const legacy = name
      .slice(prefix.length)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toUpperCase();

    if (legacy) {
      aliased[legacy] = value;
    }
  }

  return aliased as T;
}
