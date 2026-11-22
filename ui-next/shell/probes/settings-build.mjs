// Builds the Settings fixture (settings-fixture.html, the only entry) with the repository's own Vite configuration, as build-fixture.mjs builds the other fixtures: the React Compiler, CSS Modules, the cascade layers, the
// minifier. Run from the repository root with OMNIVIEW_UI=next:
//   node ui-next/shell/probes/settings-build.mjs <outDir> [development]
// The probe reads every number from the production build, and counts React's commits there too (the DevTools hook React calls on every commit, as ui-next/page/probes/sort.mjs does), so it needs no second build; `development` is
// here for a developer who wants React's own warnings on the page. The channel's own build is untouched: it has ui-next/index.html as its only input.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const outDir = path.resolve(process.argv[2] ?? '');
const mode = process.argv[3] === 'development' ? 'development' : 'production';

const loaded = await loadConfigFromFile({ command: 'build', mode }, path.join(repo, 'vite.config.ts'));
if (loaded === null) throw new Error('vite.config.ts not found');
await build(
  mergeConfig(loaded.config, {
    configFile: false,
    logLevel: 'warn',
    mode,
    build: {
      outDir,
      emptyOutDir: true,
      ...(mode === 'development' ? { minify: false } : {}),
      rollupOptions: { input: [path.join(here, 'settings-fixture.html')] },
    },
  }),
);
console.log(`settings fixture built in ${outDir} (${mode})`);
