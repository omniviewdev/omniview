import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { safeFilename } from '../src/safeFilename';
import { SHARED_PACKAGES } from '../src/sharedPackages';
import { discoverExports } from './shared-exports';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shimsDir = process.env.OMNIVIEW_SHIMS_OUTPUT_DIRECTORY || path.resolve(scriptDir, '..', 'shims');

/** Evaluate the facade against the host namespace and check every binding. */
export function validateShimExports(
  packageName: string,
  names: readonly string[],
  source: string,
  namespace: Record<string, unknown> = Object.fromEntries(names.map(name => [name, Object.freeze({ name })])),
): void {
  const module = { exports: {} as Record<string, unknown> };
  const code = transformSync(source, { format: 'cjs', loader: 'js' }).code;
  runInNewContext(code, {
    module,
    exports: module.exports,
    window: { __OMNIVIEW_SHARED__: { [packageName]: namespace } },
  });
  const actual = module.exports;
  assert.deepEqual(Object.keys(actual).sort(), [...names].sort(), `${packageName}: export names differ`);
  for (const name of names) {
    assert.strictEqual(actual[name], namespace[name], `${packageName}: incorrect singleton binding ${name}`);
  }
}

async function checkSharedShims(): Promise<void> {
  const hostSource = ts.createSourceFile('shared_dependencies.ts',
    fs.readFileSync(path.resolve(scriptDir, '../../../ui/features/plugins/api/shared_dependencies.ts'), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const hostNames: string[] = [];
  for (const statement of hostSource.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'shared' ||
          !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        assert.ok(ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name),
          'Host shared registry must declare explicit string package keys');
        hostNames.push(property.name.text);
      }
    }
  }
  const expectedFiles = SHARED_PACKAGES.map(name => `${safeFilename(name)}.mjs`).sort();
  assert.deepEqual(fs.readdirSync(shimsDir).filter(name => name.endsWith('.mjs')).sort(), expectedFiles,
    'Shared shim package names differ; regenerate shims after updating shared packages');
  assert.deepEqual(hostNames.sort(), [...SHARED_PACKAGES].sort(),
    'Host singleton package names differ from the plugin shared package registry');
  for (const packageName of SHARED_PACKAGES) {
    const { names, namespace } = await discoverExports(packageName);
    validateShimExports(packageName, names,
      fs.readFileSync(path.join(shimsDir, `${safeFilename(packageName)}.mjs`), 'utf8'), namespace);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkSharedShims();
}
