// What counts.mjs requires of its own run (the real-engine version of the kit's jsdom assertions): the command fails when one of these does not hold.

/** What the page's ThemeProvider writes at mount, and the product's way to flip the root (data attributes on <html>, never a style): not a write the view makes. */
const THEME_ATTRIBUTES = new Set(['HTML.data-ov-theme', 'HTML.data-ov-density', 'HTML.data-ov-text-size']);

/** The attribute writes at the root (`TAG.attribute`, as the harness records them) that the view's mount is answerable for: all but the ThemeProvider's. */
export const ownWrites = (records) => records.filter((record) => !THEME_ATTRIBUTES.has(record));

/** The failures of a counts run, as lines: a write at the root (attribute, or custom property) at any size, or a hook count that differs from the Profiler's. */
export function countsFailures({ results, commits }) {
  const failures = [];
  for (const result of results) {
    const size = result.lines.toLocaleString('en-US');
    if (result.rootWrites.length > 0) {
      failures.push(`${size} lines: ${result.rootWrites.length} attribute write(s) at <html> or <body>: ${result.rootWrites.join(', ')}`);
    }

    if (result.afterUnmount.rootCustomWrites !== 0) {
      failures.push(`${size} lines: ${result.afterUnmount.rootCustomWrites} custom property write(s) at the root`);
    }
  }

  if (commits.hook !== commits.profiler) {
    failures.push(`the DevTools hook's commit count (hook ${commits.hook}) differs from the Profiler's (Profiler ${commits.profiler})`);
  }

  return failures;
}
