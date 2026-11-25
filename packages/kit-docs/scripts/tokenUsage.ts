import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import ts from 'typescript';
import { TOKEN_NAMES, type TokenName } from '../../kit/src/generated/tokenNames.ts';

export type TokenUse = {
  name: TokenName;
  property: string;
  selector: string;
  path: string;
  kind: 'direct' | 'shared' | 'composed';
};

type ImportEdge = { path: string; names?: string[] };
type ExportEdge = { path: string; exported?: string; imported?: string };
type Sheet = { path: string; classes: Set<string> | undefined };
type Module = { imports: ImportEdge[]; exports: ExportEdge[]; localExports: Set<string>; sheets: Sheet[] };
type Declaration = Omit<TokenUse, 'kind'> & { classes: Set<string> };

const tokenNames = new Set<string>(TOKEN_NAMES);
const isTokenName = (name: string): name is TokenName => tokenNames.has(name);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function stylesheetClasses(source: ts.SourceFile, binding: string): Set<string> | undefined {
  const classes = new Set<string>();
  let computed = false;
  function visit(node: ts.Node) {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && ts.isIdentifier(node.expression) && node.expression.text === binding) {
      if (ts.isPropertyAccessExpression(node)) classes.add(node.name.text);
      else if (ts.isStringLiteralLike(node.argumentExpression)) classes.add(node.argumentExpression.text);
      else computed = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return computed || !classes.size ? undefined : classes;
}

function readDeclarations(kit: string, path: string): Declaration[] {
  const declarations: Declaration[] = [];
  const css = postcss.parse(readFileSync(join(kit, path), 'utf8'), { from: path });
  css.walkDecls((decl) => {
    const names = new Set<TokenName>();
    valueParser(decl.value).walk((node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return;
      const argument = node.nodes.find((item) => item.type !== 'space' && item.type !== 'comment');
      if (argument?.type === 'word' && isTokenName(argument.value)) names.add(argument.value);
      // Continue walking inside var(): fallback expressions may themselves use tokens.
    });
    if (!names.size) return;

    const parents: string[] = [];
    const selectors: string[] = [];
    for (let parent = decl.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'rule') {
        selectors.unshift(parent.selector);
        parents.unshift(parent.selector);
      } else if (parent.type === 'atrule' && parent.name !== 'layer') {
        parents.unshift(`@${parent.name}${parent.params ? ` ${parent.params}` : ''}`);
      }
    }
    const selector = parents.join(' → ') || '(stylesheet root)';
    const classes = new Set(selectors.join(' ').replace(/\[[^\]]*\]/g, '')
      .match(/\.[a-zA-Z_][\w-]*/g)?.map((name) => name.slice(1)) ?? []);
    for (const name of names) declarations.push({ name, property: decl.prop, selector, path, classes });
  });
  return declarations;
}

/**
 * Discover authored component rules, including data-attribute variants selected at runtime.
 * Theme token definitions and caller-side tokenVar calls are not component declarations.
 */
export function readTokenUsage(kit: string, parts: readonly string[]): Record<string, TokenUse[]> {
  const modules = new Map<string, Module>();
  const declarations = new Map<string, Declaration[]>();
  const componentDirs = new Map<string, boolean>();

  function resolve(importer: string, request: string): string | undefined {
    if (!request.startsWith('.')) return;
    const base = join(dirname(importer), request);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
    for (const candidate of candidates) {
      const path = relative('.', candidate).split(sep).join('/');
      if (!path.startsWith('src/') || /(?:^|\/)(?:examples?|tests?|__tests__)(?:[/.]|$)|\.(?:examples?|test|spec)\./i.test(path)) continue;
      if (statSync(join(kit, path), { throwIfNoEntry: false })?.isFile()) return path;
    }
  }

  function readModule(path: string): Module {
    const cached = modules.get(path);
    if (cached) return cached;
    const source = ts.createSourceFile(path, readFileSync(join(kit, path), 'utf8'), ts.ScriptTarget.Latest, true);
    const result: Module = { imports: [], exports: [], localExports: new Set(), sheets: [] };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolve(path, statement.moduleSpecifier.text);
        if (!target) continue;
        const clause = statement.importClause;
        if (target.endsWith('.css')) {
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            && !clause.name && clause.namedBindings.elements.every((entry) => entry.isTypeOnly)) continue;
          const binding = clause?.name?.text;
          result.sheets.push({ path: target, classes: binding ? stylesheetClasses(source, binding) : undefined });
          continue;
        }
        const bindings = clause?.namedBindings;
        const names = clause?.name ? ['default'] : [];
        if (bindings && ts.isNamedImports(bindings)) {
          for (const entry of bindings.elements) if (!entry.isTypeOnly) names.push((entry.propertyName ?? entry.name).text);
        }
        if (!clause || (bindings && ts.isNamespaceImport(bindings))) result.imports.push({ path: target, names: undefined });
        else if (names.length) result.imports.push({ path: target, names });
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolve(path, statement.moduleSpecifier.text) : undefined;
        const clause = statement.exportClause;
        if (!clause && target) result.exports.push({ path: target });
        else if (clause && ts.isNamedExports(clause)) {
          for (const entry of clause.elements) {
            if (entry.isTypeOnly) continue;
            if (target) result.exports.push({ path: target, exported: entry.name.text, imported: (entry.propertyName ?? entry.name).text });
            else if (!statement.moduleSpecifier) result.localExports.add(entry.name.text);
          }
        } else if (clause && ts.isNamespaceExport(clause) && target) {
          result.exports.push({ path: target, exported: clause.name.text });
        }
      } else if (ts.isExportAssignment(statement)) {
        result.localExports.add('default');
      } else if (ts.canHaveModifiers(statement)) {
        const modifiers = ts.getModifiers(statement);
        if (!modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) result.localExports.add('default');
        if (ts.isVariableStatement(statement)) {
          for (const { name } of statement.declarationList.declarations) {
            if (ts.isIdentifier(name)) result.localExports.add(name.text);
          }
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
          result.localExports.add(statement.name.text);
        }
      }
    }
    modules.set(path, result);
    return result;
  }

  function exportsName(path: string, name: string, searched = new Set<string>()): boolean {
    if (searched.has(path)) return false;
    searched.add(path);
    const { exports, localExports } = readModule(path);
    return localExports.has(name) || exports.some((edge) => edge.exported === name
      || (edge.exported === undefined && name !== 'default' && exportsName(edge.path, name, searched)));
  }

  function componentOwner(path: string): string | undefined {
    const component = /^src\/components\/([^/]+)\//.exec(path)?.[1];
    if (!component) return;
    let hasBarrel = componentDirs.get(component);
    if (hasBarrel === undefined) {
      hasBarrel = statSync(join(kit, 'src/components', component, 'index.ts'), { throwIfNoEntry: false })?.isFile() ?? false;
      componentDirs.set(component, hasBarrel);
    }
    if (hasBarrel) return component;
  }

  return Object.fromEntries(parts.map((part) => {
    const entry = `src/components/${part}/index.ts`;
    const evidence = new Map<string, TokenUse>();
    const visited = new Set<string>();
    const rank = { direct: 0, shared: 1, composed: 2 };

    function visit(path: string, name: string | undefined, inherited: boolean) {
      const component = componentOwner(path);
      const composed = inherited || (component !== undefined && component !== part);
      const key = JSON.stringify([path, name, composed]);
      if (visited.has(key)) return;
      visited.add(key);
      const module = readModule(path);
      for (const sheet of module.sheets) {
        let references = declarations.get(sheet.path);
        if (!references) {
          references = readDeclarations(kit, sheet.path);
          declarations.set(sheet.path, references);
        }
        const cssOwner = componentOwner(sheet.path);
        const kind = composed || (cssOwner !== undefined && cssOwner !== part)
          ? 'composed' : cssOwner === part ? 'direct' : 'shared';
        for (const { classes, ...reference } of references) {
          if (sheet.classes && classes.size && ![...classes].some((className) => sheet.classes?.has(className))) continue;
          const key = JSON.stringify([reference.path, reference.selector, reference.property, reference.name]);
          const existing = evidence.get(key);
          if (!existing || rank[kind] < rank[existing.kind]) evidence.set(key, { ...reference, kind });
        }
      }
      for (const edge of module.imports) {
        if (!edge.names) visit(edge.path, undefined, composed);
        else for (const imported of edge.names) visit(edge.path, imported, composed);
      }
      // A named import from a barrel follows only the matching runtime re-export, not sibling components.
      const named = module.exports.filter((edge) => edge.exported !== undefined && (name === undefined || edge.exported === name));
      for (const edge of named) visit(edge.path, edge.imported, composed);
      if (name === undefined || (!named.length && name !== 'default' && !module.localExports.has(name))) {
        for (const edge of module.exports) {
          if (edge.exported === undefined && (name === undefined || exportsName(edge.path, name))) visit(edge.path, name, composed);
        }
      }
    }

    visit(entry, undefined, false);
    return [part, [...evidence.values()].sort((a, b) => rank[a.kind] - rank[b.kind]
      || compare(a.name, b.name) || compare(a.path, b.path) || compare(a.selector, b.selector) || compare(a.property, b.property))];
  }));
}
