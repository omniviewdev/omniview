import type { TokenName } from '../generated/tokenNames';

/**
 * `var(--ov-…)` for a token, checked against the generated names: a misspelled token fails type-check. This is how TypeScript
 * refers to a token (an SVG attribute, a custom property bound on one leaf); CSS files are checked by stylelint.
 */
export function tokenVar<Name extends TokenName>(name: Name): `var(${Name})` {
  return `var(${name})`;
}
