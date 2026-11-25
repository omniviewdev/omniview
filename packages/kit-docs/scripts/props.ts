import { basename, join } from 'node:path';
import ts from 'typescript';

type Prop = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
};

export type PropGroup = { name: string; props: Prop[] };

const typeFormat = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function reactTypes(program: ts.Program, checker: ts.TypeChecker) {
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== 'react') continue;
      const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
      if (!module) continue;
      const exports = checker.getExportsOfModule(module);
      const jsx = exports.find((symbol) => symbol.name === 'JSX');
      const element = jsx && checker.getExportsOfModule(jsx).find((symbol) => symbol.name === 'Element');
      const node = exports.find((symbol) => symbol.name === 'ReactNode');
      if (element && node) {
        const wrappers = new Set(exports.filter((symbol) => symbol.name === 'memo' || symbol.name === 'forwardRef'));
        return { element: checker.getDeclaredTypeOfSymbol(element), node: checker.getDeclaredTypeOfSymbol(node), wrappers };
      }
    }
  }
  throw new Error('Cannot resolve React element types for the Kit public API');
}

function bindingDefaults(checker: ts.TypeChecker, symbol: ts.Symbol, wrappers: ReadonlySet<ts.Symbol>) {
  // Use implementation bindings instead of signature parameter names. A public
  // type (e.g. a generic wrapper signature) need not share those bindings.
  function binding(node: ts.Node | undefined, seen = new Set<ts.Node>()): ts.ObjectBindingPattern | undefined {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const name = node.body && node.parameters[0]?.name;
      return name && ts.isObjectBindingPattern(name) ? name : undefined;
    }
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) return binding(node.initializer, seen);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return binding(node.expression, seen);
    }
    if (ts.isIdentifier(node)) {
      const target = checker.getSymbolAtLocation(node);
      return binding(target && resolveAlias(checker, target).valueDeclaration, seen);
    }
    if (ts.isCallExpression(node)) {
      // Follow React wrappers only. Another function may change the prop contract.
      const callee = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name : node.expression);
      if (callee && wrappers.has(resolveAlias(checker, callee))) return binding(node.arguments[0], seen);
    }
  }

  const defaults = new Map<string, string>();
  for (const declaration of symbol.declarations ?? []) {
    for (const entry of binding(declaration)?.elements ?? []) {
      const name = entry.propertyName ?? entry.name;
      if (entry.initializer && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) {
        defaults.set(name.text, entry.initializer.getText());
      }
    }
  }
  return defaults;
}

function signatureGroups(
  checker: ts.TypeChecker,
  name: string,
  signature: ts.Signature,
  defaults: ReadonlyMap<string, string>,
): PropGroup[] {
  const parameter = signature.parameters[0];
  if (!parameter) return [{ name, props: [] }];
  const paramType = checker.getTypeOfSymbol(parameter);
  const propsType = checker.getBaseConstraintOfType(paramType) ?? paramType;
  const branches = propsType.isUnion() ? propsType.types : [propsType];

  return branches.map((branch, index) => {
    const props = checker.getPropertiesOfType(branch).flatMap((property): Prop[] => {
      const tags = property.getJsDocTags(checker);
      if (tags.some((tag) => tag.name === 'internal' || tag.name === 'private')) return [];
      const type = checker.getTypeOfSymbol(property);
      const documentedDefault = tags.find((tag) => tag.name === 'default' || tag.name === 'defaultValue');
      const defaultValue = defaults.get(property.name) ?? ts.displayPartsToString(documentedDefault?.text);
      return [{
        name: property.name,
        type: checker.typeToString(type, undefined, typeFormat),
        required: !(property.flags & ts.SymbolFlags.Optional) && !(parameter.flags & ts.SymbolFlags.Optional),
        description: ts.displayPartsToString(property.getDocumentationComment(checker)),
        ...(defaultValue ? { defaultValue } : {}),
      }];
    });
    for (const info of checker.getIndexInfosOfType(branch)) {
      props.push({
        name: `[key: ${checker.typeToString(info.keyType, undefined, typeFormat)}]`,
        type: checker.typeToString(info.type, undefined, typeFormat),
        required: false,
        description: '',
      });
    }
    // One table per variant keeps constraints like Chip's mutually exclusive
    // callbacks visible. Required rows are scoped to their named variant.
    const groupName = branches.length === 1 ? name : `${name} — ${branch.aliasSymbol?.name ?? `variant ${index + 1}`}`;
    return { name: groupName, props };
  });
}

export function readProps(kit: string, parts: readonly string[]): Record<string, PropGroup[]> {
  const formatHost: ts.FormatDiagnosticsHost = {
    ...ts.sys,
    getCanonicalFileName: (file) => file,
    getNewLine: () => ts.sys.newLine,
  };
  const fail = (diagnostics: readonly ts.Diagnostic[]): never => {
    throw new Error(ts.formatDiagnostics(diagnostics, formatHost));
  };
  const config = ts.getParsedCommandLineOfConfigFile(join(kit, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => fail([diagnostic]),
  });
  if (!config) throw new Error('Cannot read Kit TypeScript config');
  if (config.errors.length) fail(config.errors);

  const entry = join(kit, 'src/index.ts');
  const program = ts.createProgram([entry], config.options);
  const checker = program.getTypeChecker();
  const root = program.getSourceFile(entry);
  const rootSymbol = root && checker.getSymbolAtLocation(root);
  if (!root || !rootSymbol) throw new Error('Cannot load the Kit public entry point');
  const react = reactTypes(program, checker);
  const publicNames = new Map(checker.getExportsOfModule(rootSymbol)
    .map((symbol) => [symbol.name, resolveAlias(checker, symbol)]));
  const requested = new Set(parts);
  const result: Record<string, PropGroup[]> = Object.fromEntries(parts.map((part) => [part, []]));

  for (const statement of root.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const part = basename(statement.moduleSpecifier.text);
    if (!requested.has(part)) continue;
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) throw new Error(`Cannot resolve the Kit public exports for ${part}`);

    const publicExports = statement.exportClause
      ? ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.flatMap((specifier) => {
          const symbol = checker.getSymbolAtLocation(specifier.name);
          return !specifier.isTypeOnly && symbol ? [symbol] : [];
        })
        : []
      : checker.getExportsOfModule(module);
    for (const exported of publicExports) {
      const symbol = resolveAlias(checker, exported);
      if (publicNames.get(exported.name) !== symbol || !(symbol.flags & ts.SymbolFlags.Value)
        || exported.declarations?.every((decl) => ts.isExportSpecifier(decl) && (decl.isTypeOnly || decl.parent.parent.isTypeOnly))) continue;
      const signatures = checker.getTypeOfSymbol(symbol).getCallSignatures().filter((signature) => {
        const type = signature.getReturnType();
        // Require an element-bearing return type, not just any ReactNode:
        // utility functions returning strings are not components.
        const branches = type.isUnion() ? type.types : [type];
        return checker.isTypeAssignableTo(type, react.node) && branches.some((branch) =>
          !(branch.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) && checker.isTypeAssignableTo(branch, react.element));
      });
      if (!signatures.length) continue;
      const defaults = bindingDefaults(checker, symbol, react.wrappers);
      for (const [index, signature] of signatures.entries()) {
        const name = signatures.length === 1 ? exported.name : `${exported.name} — overload ${index + 1}`;
        result[part]?.push(...signatureGroups(checker, name, signature, defaults));
      }
    }
  }
  return result;
}
