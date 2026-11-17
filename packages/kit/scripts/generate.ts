/**
 * Writes what is generated: the token artefacts from the manifest (the stylesheet of custom properties and the typed names), and the two
 * registries from the part directories (the public entry `src/index.ts` and the examples registry `src/generated/examples.ts`, see
 * registry.ts).
 *
 *   node scripts/generate.ts           write the generated files
 *   node scripts/generate.ts --check   fail when a generated file differs from what the manifest and the directories produce
 *
 * The generated files are committed so that the type-check and the build need no step before them; CI runs `--check`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBarrel, renderExamplesRegistry, scanLayout } from './registry.ts';
import { renderTokenNames, renderTokensCss } from '../tokens/render.ts';
import { DEFAULT_THEME_ID, THEME_DEFINITIONS } from '../tokens/themes.ts';
import { validateThemeDefinitions } from '../tokens/validate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const themes = validateThemeDefinitions(THEME_DEFINITIONS, DEFAULT_THEME_ID);
const layout = await scanLayout(path.join(root, 'src'));
const outputs: ReadonlyArray<readonly [string, string]> = [
  ['src/generated/tokens.css', renderTokensCss(themes, DEFAULT_THEME_ID)],
  ['src/generated/tokenNames.ts', renderTokenNames(themes, DEFAULT_THEME_ID)],
  ['src/generated/examples.ts', renderExamplesRegistry(layout)],
  ['src/index.ts', renderBarrel(layout)],
];

const stale: string[] = [];
for (const [relative, content] of outputs) {
  const file = path.join(root, relative);
  if (check) {
    const current = await readFile(file, 'utf8').catch(() => undefined);
    if (current !== content) {
      stale.push(relative);
    }

    continue;
  }

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

if (stale.length > 0) {
  process.stderr.write(
    `Generated files are stale: ${stale.join(', ')}\nRun \`pnpm --filter @omniviewdev/kit run generate\` and commit the result.\n`,
  );
  process.exit(1);
}
