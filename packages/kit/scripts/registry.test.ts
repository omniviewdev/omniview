import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindingOf, exampleKey, keyLiteral, renderBarrel, renderExamplesRegistry, scanLayout } from './registry.ts';

const kitRoot = path.resolve(import.meta.dirname, '..');
const roots: string[] = [];

/** A `src` tree with the given files (relative paths, empty contents). */
async function tree(files: readonly string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kit-registry-'));
  roots.push(root);
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '');
  }

  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

const FOUNDATION = ['shared/index.ts', 'theme/index.ts'];

describe('the registries are generated from the part directories', () => {
  it('names an examples file by its public name: dots separate words of one name', () => {
    expect(exampleKey('Button.examples.tsx')).toBe('Button');
    expect(exampleKey('DataTable.parity.examples.tsx')).toBe('DataTableParity');
  });

  it('makes a new part a directory and nothing else: its index.ts and examples file reach both registries', async () => {
    const root = await tree([...FOUNDATION, 'components/Zebra/index.ts', 'components/Zebra/Zebra.examples.tsx', 'components/Alpha/index.ts', 'components/Alpha/Alpha.examples.tsx']);
    const layout = await scanLayout(root);
    expect(renderBarrel(layout)).toContain(
      ['export * from \'./components/Alpha\';', 'export * from \'./components/Zebra\';', 'export type * from \'./shared\';', 'export * from \'./theme\';', ''].join('\n'),
    );
    const registry = renderExamplesRegistry(layout);
    expect(registry).toContain('import * as alphaModule from \'../components/Alpha/Alpha.examples\';');
    expect(registry).toContain('  Alpha: alphaModule,\n  Zebra: zebraModule,\n');
  });

  it('is stable: the order of the directories on disk does not change the output', async () => {
    const files = [...FOUNDATION, 'components/B/index.ts', 'components/B/B.examples.tsx', 'components/A/index.ts', 'components/A/A.examples.tsx', 'components/A/A.more.examples.tsx'];
    const forward = await scanLayout(await tree(files));
    const backward = await scanLayout(await tree([...files].reverse()));
    expect(renderBarrel(backward)).toBe(renderBarrel(forward));
    expect(renderExamplesRegistry(backward)).toBe(renderExamplesRegistry(forward));
    expect(renderExamplesRegistry(forward)).toContain('  A: aModule,\n  AMore: aMoreModule,\n  B: bModule,\n');
  });

  it('keeps a directory without an index.ts internal: nothing of it is public, its examples file still is registered', async () => {
    const layout = await scanLayout(await tree([...FOUNDATION, 'components/Helper/helper.ts', 'components/Helper/Helper.examples.tsx']));
    expect(renderBarrel(layout)).not.toContain('Helper');
    expect(renderExamplesRegistry(layout)).toContain('Helper: helperModule');
  });

  it('refuses two examples files with one name', () => {
    expect(() =>
      renderExamplesRegistry({
        publicDirectories: [],
        examples: [
          { key: 'Same', module: '../components/A/Same.examples' },
          { key: 'Same', module: '../components/B/Same.examples' },
        ],
      }),
    ).toThrow(/both called Same/);
  });

  it('never lets an import name collide with the registry export, and quotes a key that is not a plain identifier', async () => {
    expect(bindingOf('Part')).toBe('partModule');
    expect(bindingOf('DataTableHigh-contrast')).toBe('dataTableHigh_contrastModule');
    expect(keyLiteral('Part')).toBe('Part');
    expect(keyLiteral('DataTableHigh-contrast')).toBe('\'DataTableHigh-contrast\'');
    const layout = await scanLayout(await tree([...FOUNDATION, 'components/Part/index.ts', 'components/Part/Part.examples.tsx', 'components/Part/Part.high-contrast.examples.tsx']));
    const registry = renderExamplesRegistry(layout);
    expect(registry).toContain('import * as partModule from \'../components/Part/Part.examples\';');
    expect(registry).toContain('  \'PartHigh-contrast\': partHigh_contrastModule,');
    expect(registry).toContain('  Part: partModule,\n');
  });

  it('refuses two examples files whose names give one import name', () => {
    expect(() =>
      renderExamplesRegistry({
        publicDirectories: [],
        examples: [
          { key: 'A-b', module: '../components/A/A.b.examples' },
          { key: 'A_b', module: '../components/A/A_b.examples' },
        ],
      }),
    ).toThrow(/same import name/);
  });

  it('refuses a foundation directory without an index.ts', async () => {
    await expect(scanLayout(await tree(['theme/index.ts', 'shared/other.ts', 'components/A/index.ts']))).rejects.toThrow(/src\/shared has no index\.ts/);
  });

  it('matches the committed files: this is what `generate:check` fails on in CI', async () => {
    const layout = await scanLayout(path.join(kitRoot, 'src'));
    expect(await readFile(path.join(kitRoot, 'src/index.ts'), 'utf8')).toBe(renderBarrel(layout));
    expect(await readFile(path.join(kitRoot, 'src/generated/examples.ts'), 'utf8')).toBe(renderExamplesRegistry(layout));
  });
});
