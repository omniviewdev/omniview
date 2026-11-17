import postcss, { AtRule } from 'postcss';
import type { ChildNode, Container, Document, Root } from 'postcss';

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

/** Where a font file of the built stylesheet is: in `fonts/` beside it, a WOFF2 file (scripts/kitFonts.ts). */
const FONT_URL = /^\.\/fonts\/[^/]+\.woff2$/;

/** Where a font file is in the HOST's build: the host's bundler takes the kit's files into `assets/`, hashed, and rewrites the URL (scripts/ui-flavour.test.mjs). */
export const HOST_FONT_URL = /^\/assets\/[^/]+\.woff2$/;

/**
 * What the built stylesheet must satisfy, as a list of violations (empty when it holds):
 * the layer order is the first rule and appears once; every other rule sits in a declared layer; a token is defined only in
 * `ov.tokens`; every token read is defined; no `!important`; every font is a WOFF2 file at `fontUrl` (the kit's own: beside the stylesheet).
 */
export function checkStylesheet(css: string, layerOrder: readonly string[], fontUrl: RegExp = FONT_URL): string[] {
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
  for (const source of fontSources(root)) {
    if (source.startsWith('data:')) {
      violations.push('a font inlined as a data URI: font files ship beside the stylesheet (scripts/kitFonts.ts)');
    } else if (!fontUrl.test(source)) {
      violations.push(`a font source must be ${fontUrl === FONT_URL ? './fonts/<file>.woff2' : String(fontUrl)}, found ${source}`);
    }
  }

  return [...new Set(violations)];
}

/** The URLs of the `src` of every `@font-face` of a stylesheet, as written. */
function fontSources(root: Root): string[] {
  const sources: string[] = [];
  root.walkAtRules('font-face', (rule) => {
    rule.walkDecls('src', (decl) => {
      for (const [, , url] of decl.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
        sources.push(url ?? '');
      }
    });
  });
  return sources;
}

/** The font files a built stylesheet refers to, by name and once each: they must exist beside it, in `fonts/`. */
export function fontFiles(css: string): string[] {
  const names = fontSources(postcss.parse(css))
    .filter((source) => FONT_URL.test(source))
    .map((source) => source.slice('./fonts/'.length));
  return [...new Set(names)].sort();
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
