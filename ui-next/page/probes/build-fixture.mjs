// Builds the fixture entry (fixture.html) with the repository's own Vite configuration, so it is compiled and styled exactly as the channel's
// build is: the React Compiler, CSS Modules, the cascade layers. Run from the repository root with OMNIVIEW_UI=next:
//   OMNIVIEW_UI=next node ui-next/page/probes/build-fixture.mjs <outDir>
// The page probe (page-probe.mjs) runs it on its own into a temporary directory; run it by hand to look at a case in a browser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const outDir = path.resolve(process.argv[2] ?? '');

const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(repo, 'vite.config.ts'));
if (loaded === null) throw new Error('vite.config.ts not found');
await build(mergeConfig(loaded.config, { configFile: false, logLevel: 'warn', build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(here, 'fixture.html') } } }));
console.log('fixture built in', outDir);
