import postcss, { AtRule } from 'postcss';
import type { ChildNode, Container, Document } from 'postcss';

/** One style rule of a stylesheet: its selector as written, the at-rules around it, and its declarations (property to value). */
export type CssRule = {
  readonly selector: string;
  /** The at-rules the rule sits in, outermost first, as `@name params`: `@layer ov.components`, `@media (prefers-reduced-motion: reduce)`. */
  readonly context: readonly string[];
  readonly declarations: Readonly<Record<string, string>>;
};

function contextOf(node: ChildNode): string[] {
  const context: string[] = [];
  let parent: Container | Document | undefined = node.parent;
  while (parent !== undefined) {
    if (parent instanceof AtRule) {
      context.unshift(`@${parent.name} ${parent.params}`.trim());
    }

    parent = parent.parent;
  }

  return context;
}

/** Every style rule of a stylesheet, in source order, however deep it sits in `@layer` and `@media` blocks. Keyframe steps are not rules of the part. */
export function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  postcss.parse(css).walkRules((rule) => {
    const context = contextOf(rule);
    if (context.some((entry) => entry.startsWith('@keyframes'))) {
      return;
    }

    const declarations: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
    rules.push({ selector: rule.selector.replace(/\s+/g, ' ').trim(), context, declarations });
  });
  return rules;
}

/**
 * The declarations of the rules whose selector is exactly `selector` (whitespace aside), merged in source order. `within` names an
 * at-rule the rule must sit in, by a fragment of its text (`prefers-reduced-motion`); without it the rules outside `@media` are meant.
 * Throws when no rule matches, so a test of a missing rule fails with the selector in its message.
 */
export function declarationsOf(css: string, selector: string, within?: string): Readonly<Record<string, string>> {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  const matches = cssRules(css).filter(
    (rule) => rule.selector.split(/\s*,\s*/).includes(wanted) && (within === undefined ? !rule.context.some((entry) => entry.startsWith('@media')) : rule.context.some((entry) => entry.includes(within))),
  );
  if (matches.length === 0) {
    throw new Error(`no rule for the selector ${wanted}${within === undefined ? '' : ` within ${within}`}`);
  }

  return Object.assign({}, ...matches.map((rule) => rule.declarations)) as Record<string, string>;
}
