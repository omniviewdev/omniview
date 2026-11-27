import { realpathSync } from 'node:fs';
import path from 'node:path';
import { rollup } from 'rollup';
import ts from 'typescript';
import { fail, type Role, type Watch } from './data';
import { localFile, publishedTypes } from './resolve';

const productionViews = ['react', 'react/jsx-runtime', 'react/compiler-runtime', '@omniviewdev/kit'];
const roleEntries = ['extension.ts', 'entry.ts', 'features.ts', 'views.tsx'];

/** A separate Rollup graph per role prevents shared chunks, page transforms, shared shims and CSS injection. */
export async function moduleBytes(root: string, role: Role, program: ts.Program, development: boolean, watch: Watch): Promise<string> {
  const entry = realpathSync(path.join(root, 'src', role.source));
  const allowed = new Set(role.source === 'views.tsx' ? productionViews : []);
  if (development && role.source === 'views.tsx') {
    allowed.add('react/jsx-dev-runtime');
  }

  const options = program.getCompilerOptions();
  if (role.source === 'views.tsx') {
    publishedTypes('react', entry, options);
  }

  function resolve(specifier: string, importer: string): string {
    const file = localFile(specifier, importer, root, options, false);
    if (path.dirname(file) === path.join(root, 'src') && roleEntries.includes(path.basename(file)) && file !== entry) {
      fail(`${role.source}: cannot import another extension or page entry`);
    }

    return file;
  }

  function validateSource(sf: ts.SourceFile): void {
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true ||
          (!node.importClause?.name && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.length > 0 && node.importClause.namedBindings.elements.every(e => e.isTypeOnly)) :
          node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly));
        if (!typeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const source = node.moduleSpecifier.text;
          if (allowed.has(source)) {
            publishedTypes(source, sf.fileName, options);
          } else {
            resolve(source, sf.fileName);
          }
        }
      }

      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword ||
          ts.isImportEqualsDeclaration(node) ||
          ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(node.expression) && ['require', 'importScripts'].includes(node.expression.text)) ||
          ts.isIdentifier(node) && node.text === 'System' ||
          ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['Worker', 'SharedWorker'].includes(node.expression.text)) {
        fail(`${role.source}: dynamic imports, authored module loaders and worker assets are not allowed`);
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  const bundle = await rollup({
    input: entry, preserveEntrySignatures: 'strict',
    plugins: [{
      name: 'omniview-extension-module',
      resolveId(source, importer) {
        if (!importer && source === entry) {
          return entry;
        }

        if (allowed.has(source)) {
          return { id: source, external: true };
        }

        if (!importer) {
          return fail('expected a single role entry');
        }

        return resolve(source, importer);
      },
      resolveDynamicImport() {
        return fail('dynamic imports are not allowed in extension modules');
      },
      load(id) {
        watch(id);
        const sf = program.getSourceFile(id);
        if (!sf || sf.isDeclarationFile || /\.[cm]?jsx?$/.test(id) && !options.checkJs) {
          fail('role modules and local helpers must be type-checked source');
        }

        validateSource(sf);
        return ts.transpileModule(sf.text, { fileName: id, compilerOptions: {
          target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: development ? ts.JsxEmit.ReactJSXDev : ts.JsxEmit.ReactJSX,
          jsxImportSource: 'react', verbatimModuleSyntax: options.verbatimModuleSyntax, useDefineForClassFields: options.useDefineForClassFields,
        } }).outputText;
      },
    }],
  });
  try {
    const { output } = await bundle.generate({ format: 'system', exports: 'named', sourcemap: false });
    const chunk = output[0];
    if (output.length !== 1 || chunk.type !== 'chunk' || !chunk.isEntry || chunk.facadeModuleId !== entry || chunk.dynamicImports.length ||
        chunk.referencedFiles.length || chunk.imports.some(name => !allowed.has(name))) {
      fail(`${role.asset}: expected one fixed anonymous System.register module`);
    }

    const actual = new Set(chunk.exports);
    if (actual.size !== role.names.length || role.names.some(name => !actual.has(name))) {
      fail(`${role.asset}: emitted named exports must match exactly the offers for this role`);
    }

    if (Buffer.byteLength(chunk.code) > 1024 * 1024) {
      fail(`${role.asset}: exceeds 1 MiB decoded`);
    }

    return chunk.code;
  } finally {
    await bundle.close();
  }
}
