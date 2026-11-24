import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export type SourceFile = { name: string; code: string };
export type ExampleSource = { group: string; name: string; files: SourceFile[]; path: string; line: number };

type Input = { group: string; path: string; exportName?: string; name?: string };

function hasExport(node: ts.Node) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
}

function moduleName(node: ts.ImportDeclaration) {
  if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Unsupported import: ${node.getText()}`);
  return node.moduleSpecifier.text;
}

/** Read Kit's published group mapping without loading its CSS or browser modules into Node. */
export function kitInputs(kit: string): Input[] {
  const path = join(kit, 'src/generated/examples.ts');
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Map<string, string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamespaceImport(bindings)) throw new Error(`Expected a namespace import in ${path}`);
    const specifier = moduleName(statement);
    if (!/^\.\.\/components\/\w+\/\w+(?:\.parity)?\.examples$/.test(specifier)) {
      throw new Error(`Unexpected Kit example module: ${specifier}`);
    }
    imports.set(bindings.name.text, resolve(dirname(path), `${specifier}.tsx`));
  }
  const registry = ast.statements.flatMap((statement) => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.filter(({ name }) => ts.isIdentifier(name) && name.text === 'partExamples')
    : []);
  const mapping = registry[0]?.initializer;
  if (registry.length !== 1 || !mapping || !ts.isObjectLiteralExpression(mapping)) {
    throw new Error(`Expected a partExamples object in ${path}`);
  }
  return mapping.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isIdentifier(property.initializer)) {
      throw new Error(`Unsupported group declaration: ${property.getText(ast)}`);
    }
    const module = imports.get(property.initializer.text);
    if (!module) throw new Error(`Missing example module for ${property.name.text}`);
    return { group: property.name.text, path: module };
  });
}

export function exampleSources(inputs: readonly Input[], kit: string): ExampleSource[] {
  // Resolve lexical references without walking Kit/React's external dependency graph.
  const program = ts.createProgram([...new Set(inputs.map(({ path }) => path))], {
    jsx: ts.JsxEmit.ReactJSX,
    noResolve: true,
    noLib: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const publicLogTypes = join(kit, 'src/log/types');
  return inputs.flatMap(({ group, path, exportName, name }) => {
    const ast = program.getSourceFile(path);
    if (!ast) throw new Error(`Missing example module: ${path}`);
    const examples = ast.statements.flatMap<{ statement: ts.Statement; identifier: string }>((statement) => {
      if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
        throw new Error(`Unsupported example re-export in ${path}: ${statement.getText(ast)}`);
      }
      if (!hasExport(statement)) return [];
      if (ts.isFunctionDeclaration(statement) && statement.name) return [{ statement, identifier: statement.name.text }];
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
        const declaration = statement.declarationList.declarations[0];
        if (declaration && ts.isIdentifier(declaration.name) && declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
          return [{ statement, identifier: declaration.name.text }];
        }
      }
      throw new Error(`Unsupported example export in ${path}: ${statement.getText(ast)}`);
    }).filter(({ identifier }) => exportName === undefined || identifier === exportName);
    if (!examples.length) throw new Error(`No source examples for ${group}${exportName ? `.${exportName}` : ''}`);

    return examples.map(({ statement, identifier }) => {
      const imports = new Set<ts.Declaration>();
      const statements = new Set<ts.Statement>();
      function visitStatement(node: ts.Statement) {
        if (statements.has(node)) return;
        statements.add(node);
        function visit(child: ts.Node) {
          if (ts.isIdentifier(child)) {
            const symbol = ts.isShorthandPropertyAssignment(child.parent) && child.parent.name === child
              ? checker.getShorthandAssignmentValueSymbol(child.parent)
              : checker.getSymbolAtLocation(child);
            for (const declaration of symbol?.declarations ?? []) {
              if (declaration.getSourceFile() !== ast) continue;
              if (ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) {
                imports.add(declaration);
                continue;
              }
              // Only module-scope declarations belong in the closure. Nested declarations are
              // already included in their owning statement, including when shadowing a name.
              let owner: ts.Node = declaration;
              if (ts.isVariableDeclaration(owner)) owner = owner.parent.parent;
              if (owner.parent === ast && ts.isStatement(owner)) visitStatement(owner);
            }
          }
          ts.forEachChild(child, visit);
        }
        visit(node);
      }
      visitStatement(statement);

      const dependencies = new Map<string, SourceFile>();
      function importSpecifier(specifier: string, from: string): string {
        if (specifier === '@omniviewdev/kit' || specifier === '@omniviewdev/kit/styles.css' || specifier === 'react') return specifier;
        const resolved = resolve(dirname(from), specifier);
        if (specifier.startsWith('.') && resolved === publicLogTypes) return '@omniviewdev/kit';
        if (!/^\.\/[\w.-]+$/.test(specifier)) throw new Error(`Unsupported dependency ${specifier} in ${from}`);
        const target = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((file) => /\.(?:ts|tsx|css)$/.test(file) && existsSync(file));
        if (!target) throw new Error(`Unresolved local dependency ${specifier} in ${from}`);
        if (target === path) throw new Error(`Example cannot import its own source module: ${from}`);
        if (!dependencies.has(target)) {
          const file = { name: basename(target), code: readFileSync(target, 'utf8') };
          dependencies.set(target, file);
          if (target.endsWith('.css')) {
            if (/@import\b|\burl\s*\(/i.test(file.code)) throw new Error(`Unsupported stylesheet dependency in ${target}`);
          } else {
            const dependency = ts.createSourceFile(target, file.code, ts.ScriptTarget.Latest, true);
            const replacements: { start: number; end: number; code: string }[] = [];
            for (const item of dependency.statements) {
              if (ts.isImportDeclaration(item)) {
                const original = moduleName(item);
                const next = importSpecifier(original, target);
                if (next !== original) replacements.push({ start: item.moduleSpecifier.getStart(dependency), end: item.moduleSpecifier.getEnd(), code: JSON.stringify(next) });
              } else if (ts.isImportEqualsDeclaration(item) || (ts.isExportDeclaration(item) && item.moduleSpecifier)) {
                throw new Error(`Unsupported module dependency in ${target}: ${item.getText(dependency)}`);
              }
            }
            for (const { start, end, code } of replacements.reverse()) file.code = file.code.slice(0, start) + code + file.code.slice(end);
          }
        }
        return specifier;
      }

      const importLines = ast.statements.flatMap((item) => {
        if (!ts.isImportDeclaration(item)) return [];
        const specifier = moduleName(item);
        const { importClause: clause } = item;
        if (!clause) return [`import '${importSpecifier(specifier, path)}';`];
        const bindings: string[] = [];
        if (clause.name && imports.has(clause)) bindings.push(clause.name.text);
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) && imports.has(clause.namedBindings)) {
          bindings.push(clause.namedBindings.getText(ast));
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const used = clause.namedBindings.elements.filter((element) => imports.has(element));
          if (used.length) bindings.push(`{ ${used.map((element) => element.getText(ast)).join(', ')} }`);
        }
        return bindings.length ? [`import ${clause.isTypeOnly ? 'type ' : ''}${bindings.join(', ')} from '${importSpecifier(specifier, path)}';`] : [];
      });
      const declarations = ast.statements.filter((item) => statements.has(item)).map((item) => item.getText(ast));
      const entry = { name: `${identifier}.tsx`, code: [importLines.join('\n'), ...declarations].filter(Boolean).join('\n\n') + '\n' };
      const files = [entry, ...dependencies.values()];
      if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error(`Conflicting source filenames in ${group}.${name ?? identifier}`);
      return { group, name: name ?? identifier, files, path, line: ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1 };
    });
  });
}
