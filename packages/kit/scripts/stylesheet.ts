import postcss, { AtRule } from 'postcss';
import type { ChildNode, Container, Document } from 'postcss';

/** The node as an `@layer` at-rule, or undefined when it is anything else. */
function asLayer(node: ChildNode | Container | Document | undefined): AtRule | undefined {
  return node instanceof AtRule && node.name === 'layer' ? node : undefined;
}

/** The layers a stylesheet may declare, in order: the one statement in `src/styles/layers.css`. */
export function declaredLayerOrder(layersCss: string): readonly string[] {
  const statements = postcss
    .parse(layersCss)
    .nodes.map(asLayer)
    .filter((layer): layer is AtRule => layer !== undefined && layer.nodes === undefined);
  const [statement] = statements;
  if (statement === undefined || statements.length !== 1) {
    throw new Error(`src/styles/layers.css must hold exactly one @layer order statement, found ${statements.length}`);
  }

  return statement.params.split(',').map((name) => name.trim());
}

function layerOf(node: ChildNode): string | undefined {
  let parent: Container | Document | undefined = node.parent;
  while (parent !== undefined) {
    const layer = asLayer(parent);
    if (layer !== undefined) {
      return layer.params.trim();
    }

    parent = parent.parent;
  }

  return undefined;
}

/** The names of a layer order statement (`@layer a, b;`), or undefined when the node is anything else. */
function layerStatementNames(node: ChildNode | undefined): string[] | undefined {
  const layer = asLayer(node);
  if (layer === undefined || layer.nodes !== undefined) {
    return undefined;
  }

  return layer.params.split(',').map((name) => name.trim());
}

const UNLAYERED_ALLOWED = ['font-face', 'keyframes', 'charset'];

/**
 * What the built stylesheet must satisfy, as a list of violations (empty when it holds):
 * the layer order is the first rule and appears once; every other rule sits in a declared layer; a token is defined only in
 * `ov.tokens`; every token read is defined; no `!important`.
 */
export function checkStylesheet(css: string, layerOrder: readonly string[]): string[] {
  const violations: string[] = [];
  const root = postcss.parse(css);
  const top = root.nodes.filter((node) => node.type !== 'comment');

  const firstNames = layerStatementNames(top[0]);
  if (firstNames?.join(',') !== layerOrder.join(',')) {
    violations.push(`the first rule must be \`@layer ${layerOrder.join(', ')};\``);
  }

  for (const node of top.slice(1)) {
    const layer = asLayer(node);
    if (layer !== undefined) {
      if (layer.nodes === undefined) {
        violations.push(`a second layer order statement: @layer ${layer.params};`);
      } else if (!layerOrder.includes(layer.params.trim())) {
        violations.push(`@layer ${layer.params} is not a declared layer; it would sort after every declared layer`);
      }
    } else if (node instanceof AtRule && UNLAYERED_ALLOWED.includes(node.name)) {
      continue;
    } else {
      violations.push(`an unlayered rule: ${node.type === 'rule' ? node.selector : node.type === 'atrule' ? `@${node.name}` : node.type}`);
    }
  }

  const defined = new Set<string>();
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--ov-')) {
      defined.add(decl.prop);
      if (layerOf(decl) !== 'ov.tokens') {
        violations.push(`${decl.prop} is defined outside ov.tokens`);
      }
    }

    if (decl.important) {
      violations.push(`!important on ${decl.prop}`);
    }
  });
  root.walkDecls((decl) => {
    for (const [, name] of decl.value.matchAll(/var\(\s*(--ov-[a-z0-9-]+)/g)) {
      if (name !== undefined && !defined.has(name)) {
        violations.push(`${name} is read by \`${decl.prop}\` but defined nowhere`);
      }
    }
  });
  return [...new Set(violations)];
}

/** The `--ov-*` custom properties a stylesheet defines. */
export function definedTokens(css: string): Set<string> {
  const defined = new Set<string>();
  postcss.parse(css).walkDecls((decl) => {
    if (decl.prop.startsWith('--ov-')) {
      defined.add(decl.prop);
    }
  });
  return defined;
}
