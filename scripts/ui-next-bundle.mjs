// Builds the `next` frontend (OMNIVIEW_UI=next: ui-next/ alone) and prints what its bundle holds, as JSON on stdout: every chunk with its size and the module
// ids that went into it. `scripts/ui-flavour.test.mjs` reads it to prove the new build carries none of the previous UI libraries, and to measure what the
// modules the host shares with a plugin cost it.
//
//   node scripts/ui-next-bundle.mjs [--probe barrel] [--out <directory>]
//
// `--probe barrel` is the control: it adds one more entry to the same build that imports the runtime's WHOLE barrel (`@omniviewdev/runtime`), which is what
// registering the barrel in the shared list (`ui-next/plugins/loader/shared.ts`) would do, instead of its curated entry. The guard must go red on that build.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const probe = option('--probe');
if (probe !== undefined && probe !== 'barrel') {
  throw new Error(`unknown probe "${probe}"; the only one is "barrel"`);
}

// The config reads both variables when it loads, so they are set before `build` loads it.
const given = option('--out');
const output = given === undefined ? await mkdtemp(path.join(os.tmpdir(), 'omniview-ui-next-bundle-')) : path.resolve(given);
process.env.OMNIVIEW_UI = 'next';
process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY = output;

const PROBE = 'virtual:probe-runtime-barrel';
const chunks = [];
const plugins = [
  {
    name: 'record-bundle',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          chunks.push({
            file: file.fileName,
            entry: file.isEntry,
            bytes: Buffer.byteLength(file.code),
            gzip: gzipSync(file.code).length,
            modules: Object.keys(file.modules),
          });
        }
      }
    },
  },
];
if (probe === 'barrel') {
  plugins.push({
    name: 'probe-runtime-barrel',
    buildStart() {
      // An app build drops an entry's unused exports unless its signature is kept, and with `load` goes the import of the barrel.
      this.emitFile({ type: 'chunk', id: PROBE, preserveSignature: 'strict' });
    },
    resolveId: (source) => (source === PROBE ? PROBE : null),
    load: (id) => (id === PROBE ? "export const load = () => import('@omniviewdev/runtime');" : null),
  });
}

try {
  await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', plugins });
  process.stdout.write(`${JSON.stringify({ probe: probe ?? null, chunks })}\n`);
} finally {
  if (given === undefined) {
    await rm(output, { recursive: true, force: true });
  }
}
