// Builds the Ports fixture (ports-fixture.html) with the repository's own Vite configuration, so it is compiled and styled exactly as the channel's build is: the React Compiler, CSS Modules, the cascade layers. Run from the
// repository root with OMNIVIEW_UI=next:
//   node ui-next/shell/probes/ports-build.mjs <outDir> [development]
// `development` builds with React's development build: a Profiler calls its `onRender` there and not in a production build, and the probe counts commits with one. Everything else the probe measures is read from the production
// build. The channel's own build is untouched.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
// The build EMPTIES its output directory (`emptyOutDir`): it takes a directory of its own, one that does not exist or is empty (a fresh temp directory), and never the checkout or anything that holds files. Without an argument the
// directory would be the current one.
const given = process.argv[2];
if (given === undefined || given.trim() === '') {
  throw new Error('usage: node ui-next/shell/probes/ports-build.mjs <outDir> [development]: an output directory is required, and it is emptied');
}

const outDir = path.resolve(given);
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  throw new Error(`${outDir} is not empty: the build empties its output directory, so it takes one that does not exist or is empty`);
}
const mode = process.argv[3] === 'development' ? 'development' : 'production';
// Vite takes React's build from NODE_ENV and not from its mode: a development build with NODE_ENV unset would be a production build, and the Profiler would report no commit. Set before the configuration is loaded, so that a build made by hand and one made by the runner agree.
process.env.NODE_ENV = mode;

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
      rollupOptions: { input: [path.join(here, 'ports-fixture.html')] },
    },
  }),
);
console.log(`ports fixture built in ${outDir} (${mode})`);
