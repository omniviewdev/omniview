import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rollup/parseAst';
import ts from 'typescript';
import * as sdk from '@omniviewdev/runtime/ui/extensions/v1';
import { closed, fail, list, object, SDK, type Data, type DataObject, type LiteralExport, type Locator, type Watch } from './data';
import { contractPackage, localFile, packageName, publishedTypes, type ContractPackage } from './resolve';

const builders = { defineRead: sdk.defineRead, defineProtocol: sdk.defineProtocol, definePoint: sdk.definePoint,
  defineOffer: sdk.defineOffer, defineMenuOffer: sdk.defineMenuOffer, defineViewOffer: sdk.defineViewOffer, definePlugin: sdk.definePlugin };
const arity = { defineRead: 2, defineProtocol: 2, definePoint: 4, defineOffer: 2, defineMenuOffer: 2, defineViewOffer: 2, definePlugin: 1 };
const optionKeys = {
  defineRead: ['row'], defineProtocol: ['kind', 'fields', 'optional', 'schema', 'read'],
  definePoint: ['label', 'placement', 'warmOnPage'], definePlugin: ['id', 'points', 'offers'],
  defineOffer: ['label', 'requests', 'targets'], defineMenuOffer: ['label', 'requests', 'targets', 'action'],
  defineViewOffer: ['label', 'requests', 'targets', 'requestRead'],
};
type Builder = keyof typeof builders;
type Get = () => Data;

/** Only these data expressions have meaning. No JS interpreter, transpile-and-import, VM, or author callbacks. */
class DataModule {
  private readonly locals = new Map<string, Get>();
  private readonly declarationEnd = new Map<string, number>();
  private readonly sdkNames = new Map<string, string>();
  private readonly exports = new Map<string, Get>();
  private readonly stars: Array<() => DataModule> = [];
  private readonly values = new Map<string, Data>();
  private readonly reading = new Set<string>();
  private readonly dependencies = new Set<string>();

  constructor(private readonly graph: StaticGraph, private readonly file: string, private readonly pkg?: ContractPackage) {
    graph.watch(file);
    const code = readFileSync(file, 'utf8');
    if (pkg) {
      parseAst(code);
    } // A declaration cannot make malformed packed JS into an ESM module.

    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    for (const statement of sf.statements) {
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEmptyStatement(statement) ||
          ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
        continue;
      }

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) {
          continue;
        }

        const source = statement.moduleSpecifier.text;
        if (!clause || clause.name !== undefined || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || statement.attributes) {
          fail('metadata dependencies must be named imports');
        }

        if (source === SDK && !pkg) {
          publishedTypes(source, file, graph.options);
        }

        for (const spec of clause.namedBindings.elements) {
          if (spec.isTypeOnly) {
            continue;
          }

          const name = (spec.propertyName ?? spec.name).text;
          if (source === SDK) {
            this.sdkNames.set(spec.name.text, name);
          } else {
            if (!source.startsWith('.') && !packageName.test(source)) {
              fail('metadata imports require a public package root');
            }

            this.locals.set(spec.name.text, () => this.imported(source, name));
          }
        }

        continue;
      }

      if (ts.isVariableStatement(statement)) {
        if (!pkg && !(statement.declarationList.flags & ts.NodeFlags.Const)) {
          fail('descriptor bindings must be const');
        }

        for (const decl of statement.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) {
            fail('expected an initialized literal binding');
          }

          const name = decl.name.text, expr = decl.initializer;
          if (this.locals.has(name) || this.sdkNames.has(name)) {
            fail('duplicate metadata binding');
          }

          this.declarationEnd.set(name, decl.end);
          this.locals.set(name, () => this.expression(expr));
          if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
            this.exports.set(name, () => this.local(name));
          }
        }

        continue;
      }

      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        this.exports.set('default', () => this.expression(statement.expression));
        continue;
      }

      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) {
          continue;
        }

        const source = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
        if (source?.startsWith('.')) {
          this.dependencies.add(source);
        }

        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const spec of statement.exportClause.elements) {
            if (spec.isTypeOnly) {
              continue;
            }

            const name = (spec.propertyName ?? spec.name).text;
            this.exports.set(spec.name.text, () => source ? this.imported(source, name) : this.local(name));
          }
        } else if (!statement.exportClause && source?.startsWith('.')) {
          this.stars.push(() => this.relative(source));
        } else {
          fail('expected named or local star re-exports');
        }

        continue;
      }

      fail(`${path.basename(file)}: metadata modules may contain only literal declarations and static imports/exports`);
    }
  }

  checkInitializers(): void {
    // ESM evaluates relative re-exports and every initializer, not just the requested named export.
    for (const source of this.dependencies) {
      this.relative(source);
    }

    for (const name of this.locals.keys()) {
      this.local(name);
    }

    for (const name of this.exports.keys()) {
      this.named(name);
    }
  }

  named(name: string, searching = new Set<DataModule>()): Data {
    return this.findExport(name, searching) ?? fail(`${name}: missing named JavaScript export`);
  }

  private relative(source: string): DataModule {
    const base = this.pkg?.root ?? this.graph.root;
    return this.graph.module(localFile(source, this.file, base, this.graph.options, !!this.pkg), this.pkg);
  }

  private imported(source: string, name: string): Data {
    if (source.startsWith('.')) {
      return this.relative(source).named(name);
    }

    if (name === 'default') {
      fail('point imports must name a non-default public root export');
    }

    return this.graph.point(source, name, this.file, this.pkg?.root ?? this.graph.root);
  }

  private findExport(name: string, searching: Set<DataModule>): Data | undefined {
    if (searching.has(this)) {
      return;
    }

    const read = this.exports.get(name);
    if (read) {
      return this.memo(`export:${name}`, read);
    }

    if (name === 'default') {
      return;
    }

    searching.add(this);
    let found: Data | undefined;
    for (const star of this.stars) {
      const next = star().findExport(name, searching);
      if (next === undefined) {
        continue;
      }

      if (found !== undefined && found !== next) {
        fail('ambiguous public star re-export');
      }

      found = next;
    }

    searching.delete(this);
    return found;
  }

  private memo(name: string, read: Get): Data {
    const previous = this.values.get(name);
    if (previous !== undefined) {
      return previous;
    }

    if (this.reading.has(name)) {
      fail('cyclic metadata initializer or re-export');
    }

    this.reading.add(name);
    const value = read();
    this.reading.delete(name);
    this.values.set(name, value);
    return value;
  }

  private local(name: string, at = Infinity): Data {
    if ((this.declarationEnd.get(name) ?? -1) > at) {
      fail('metadata references an uninitialized binding');
    }

    if (this.sdkNames.get(name) === 'utilizationV1') {
      return sdk.utilizationV1;
    }

    const read = this.locals.get(name);
    if (!read) {
      fail('expected a literal const or named public point reference');
    }

    return this.memo(`local:${name}`, read);
  }

  private key(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }

    if (ts.isComputedPropertyName(name)) {
      const literal = this.expression(name.expression);
      if (typeof literal === 'string' || typeof literal === 'number') {
        return String(literal);
      }
    }

    return fail('expected a literal property name');
  }

  private expression(node: ts.Expression): Data {
    if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) {
      return this.expression(node.expression);
    }

    if (ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'const') {
      return this.expression(node.expression);
    }

    if (ts.isStringLiteralLike(node)) {
      return node.text;
    }

    if (ts.isTemplateExpression(node)) {
      let out = node.head.text;
      for (const span of node.templateSpans) {
        const value = this.expression(span.expression);
        if (typeof value === 'object') {
          fail('template interpolations must be literal scalars');
        }

        out += String(value) + span.literal.text;
        if (out.length > 256 * 1024) {
          fail('metadata initializer exceeds the manifest byte budget');
        }
      }

      return out;
    }

    if (ts.isNumericLiteral(node)) {
      return Number(node.text);
    }

    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return -Number(node.operand.text);
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return node.kind === ts.SyntaxKind.TrueKeyword;
    }

    if (ts.isIdentifier(node)) {
      return this.local(node.text, node.pos);
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) {
        fail('conditional descriptor members are not literal');
      }

      const key = ts.isPropertyAccessExpression(node) ? node.name.text : this.expression(node.argumentExpression);
      const source = this.expression(node.expression);
      if (typeof source !== 'object' || !(typeof key === 'string' || typeof key === 'number') || !Object.hasOwn(source, key)) {
        fail('expected an own literal member');
      }

      return (source as DataObject)[key];
    }

    if (ts.isObjectLiteralExpression(node)) {
      const out: DataObject = Object.create(null);
      for (const p of node.properties) {
        if (ts.isSpreadAssignment(p)) {
          Object.assign(out, object(this.expression(p.expression), 'spread'));
        } else if (ts.isShorthandPropertyAssignment(p) && !p.objectAssignmentInitializer) {
          out[p.name.text] = this.local(p.name.text, p.pos);
        } else if (ts.isPropertyAssignment(p)) {
          out[this.key(p.name)] = this.expression(p.initializer);
        } else {
          fail('metadata must contain own data properties, not methods or accessors');
        }
      }

      return out;
    }

    if (ts.isArrayLiteralExpression(node)) {
      const out: Data[] = [];
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) {
          const values = list(this.expression(item.expression), 'spread');
          if (out.length + values.length > 256 * 1024) {
            fail('metadata tuple expansion exceeds the manifest byte budget');
          }

          for (const value of values) {
            out.push(value);
          }
        } else {
          out.push(this.expression(item));
        }
      }

      return out;
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !node.questionDotToken && !node.typeArguments?.length) {
      const name = this.sdkNames.get(node.expression.text);
      if (!name || !Object.hasOwn(builders, name)) {
        fail('only named SDK builders can initialize metadata');
      }

      const builder = name as Builder;
      if (arity[builder] !== node.arguments.length) {
        fail(`${builder}: unexpected argument count`);
      }

      const args = node.arguments.map(a => this.expression(a));
      closed(object(args[args.length - 1], builder), builder, optionKeys[builder]);
      // Only the packager's trusted SDK builders execute, on data constructed above.
      const value = (builders[builder] as unknown as (...args: Data[]) => DataObject)(...args);
      this.graph.built.set(value, builder);
      return value;
    }

    return fail(`${path.basename(this.file)}: expected a literal initializer, not a dynamic expression or type assertion`);
  }
}

export class StaticGraph {
  readonly locators = new WeakMap<DataObject, Locator>();
  readonly built = new WeakMap<DataObject, Builder>();
  readonly proofs: LiteralExport[] = [];
  private readonly modules = new Map<string, DataModule>();
  private readonly packages = new Map<string, ContractPackage>();
  private readonly points = new Map<string, DataObject>();

  constructor(readonly root: string, readonly options: ts.CompilerOptions, readonly watch: Watch) {}

  get importedPoints(): Iterable<DataObject> {
    return this.points.values();
  }

  module(file: string, pkg?: ContractPackage): DataModule {
    const cached = this.modules.get(file);
    if (cached) {
      return cached;
    }

    const mod = new DataModule(this, file, pkg);
    this.modules.set(file, mod);
    mod.checkInitializers();
    return mod;
  }

  point(source: string, name: string, from: string, consumingRoot: string): DataObject {
    const packageKey = `${consumingRoot}\0${source}`;
    let pkg = this.packages.get(packageKey);
    if (!pkg) {
      pkg = contractPackage(source, from, consumingRoot, this.options, this.watch);
      this.packages.set(packageKey, pkg);
    }

    const key = `${pkg.root}\0${name}`;
    const cached = this.points.get(key);
    if (cached) {
      return cached;
    }

    // Each public alias has its own provenance, even when two exports refer to one point object.
    const value = { ...object(this.module(pkg.script, pkg).named(name), 'published point') };
    this.locators.set(value, { package: pkg.name, version: pkg.version, export: name });
    this.proofs.push({ file: pkg.types, name, value });
    this.points.set(key, value);
    return value;
  }

  descriptor(file: string): DataObject {
    const value = object(this.module(realpathSync(file)).named('default'), 'default');
    if (this.built.get(value) !== 'definePlugin') {
      fail('extension.ts must default-export definePlugin data');
    }

    this.proofs.push({ file, name: 'default', value });
    return value;
  }
}
