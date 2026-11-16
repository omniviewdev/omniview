/** The only attributes a part passes through to its element: `data-*`, for tests and probes. Nothing else reaches the DOM. */
export type DataAttributes = Readonly<Record<`data-${string}`, string | number | boolean | undefined>>;

/**
 * The `data-*` entries of `rest`. Types already close the props; this keeps them closed for a caller that bypasses the types
 * (plain JavaScript, a cast), and returns `rest` itself, without copying, when every key is a `data-*` key.
 */
export function dataAttributes(rest: Record<string, unknown>): DataAttributes {
  for (const key in rest) {
    if (!key.startsWith('data-')) {
      return Object.fromEntries(Object.entries(rest).filter(([name]) => name.startsWith('data-'))) as DataAttributes;
    }
  }

  return rest as DataAttributes;
}
