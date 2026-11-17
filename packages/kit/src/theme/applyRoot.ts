/*
 * Adapted from omniviewdev/ui `packages/base-ui/src/theme/applyTheme.ts` and the root-preference part of `ThemeProvider.tsx`
 * at 65bbefb. Carried over: the root is flipped by data attributes alone, applied before paint, and restored on cleanup.
 * Not carried over: custom themes written as inline `--ov-*` properties on the root (strategy R6 forbids a custom property
 * written at the root at run time), the owner stack for several providers on one root (one provider per document), and
 * `color-scheme` set as an inline style (each generated theme block sets it).
 */

/** The attributes the token stylesheet reads. Their values are the ids and steps of the generated names. */
export const ROOT_ATTRIBUTES = {
  theme: 'data-ov-theme',
  density: 'data-ov-density',
  textSize: 'data-ov-text-size',
} as const;

export type RootAttributeValues = Readonly<Record<keyof typeof ROOT_ATTRIBUTES, string>>;

/** Set the attributes on `root` and return a function that puts back what was there. Writes attributes only, never a style. */
export function applyRootAttributes(root: HTMLElement, values: RootAttributeValues): () => void {
  const keys = Object.keys(ROOT_ATTRIBUTES) as Array<keyof typeof ROOT_ATTRIBUTES>;
  const previous = keys.map((key) => [ROOT_ATTRIBUTES[key], root.getAttribute(ROOT_ATTRIBUTES[key])] as const);
  for (const key of keys) {
    root.setAttribute(ROOT_ATTRIBUTES[key], values[key]);
  }

  return () => {
    for (const [attribute, value] of previous) {
      if (value === null) {
        root.removeAttribute(attribute);
      } else {
        root.setAttribute(attribute, value);
      }
    }
  };
}
