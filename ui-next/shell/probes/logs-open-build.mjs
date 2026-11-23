// Builds the fixture of the Logs-at-open probe (logs-open-fixture.html, its only entry) with the repository's own Vite configuration, as build-fixture.mjs builds the others: the React Compiler, CSS Modules, the cascade layers. Run
// from the repository root with OMNIVIEW_UI=next:
//   node ui-next/shell/probes/logs-open-build.mjs <outDir>
// logs-open-probe.mjs runs it through packages/kit/probes/build-cache.mjs, so that the probe and its controls, which are a process each, build it once for a shard.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const outDir = path.resolve(process.argv[2] ?? '');

const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(repo, 'vite.config.ts'));
if (loaded === null) throw new Error('vite.config.ts not found');
await build(mergeConfig(loaded.config, { configFile: false, logLevel: 'warn', mode: 'production', build: { outDir, emptyOutDir: true, rollupOptions: { input: [path.join(here, 'logs-open-fixture.html')] } } }));
console.log(`logs-open fixture built in ${outDir}`);
