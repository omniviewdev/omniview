// Builds the fixture entries (fixture.html, host-fixture.html, palette-fixture.html, palette-plugins-fixture.html) with the repository's own Vite configuration, so they are compiled and styled exactly as the channel's
// build is: the React Compiler, CSS Modules, the cascade layers. Run from the repository root with OMNIVIEW_UI=next:
//   node ui-next/shell/probes/build-fixture.mjs <outDir> [development]
// `development` builds with React's development build: a Profiler calls its `onRender` there and not in a production build, and the probe counts commits with one (the count of commits
// of a tab switch does not depend on the build). Everything else the probe measures is read from the production build. The channel's own build is untouched.
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
      rollupOptions: { input: ['fixture.html', 'host-fixture.html', 'palette-fixture.html', 'palette-plugins-fixture.html'].map((name) => path.join(here, name)) },
    },
  }),
);
console.log(`fixtures built in ${outDir} (${mode})`);
