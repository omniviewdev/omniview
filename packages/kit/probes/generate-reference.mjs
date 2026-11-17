// Regenerates the pinned copies of the design mock's values that the probes (and CI) compare the kit with:
//   mock-reference.json   the parts (Button, IconButton, Icon): read by kit-probe.mjs; made by mock-measure.mjs
//   mock-table.json       the table (rows, header, selection, sort, states, the fit): read by table-probe.mjs; made by mock-table-measure.mjs
//
//   node packages/kit/probes/generate-reference.mjs --lab <a checkout of the private repository omniviewdev/design-lab>
//
// The design lab is private and is only needed here, never in CI. The script
//   1. checks the checkout holds tag spec-baseline-2026-11-16 (commit 108d7049...) and that the mock at that tag is the tree c8e44a44...
//      (`git rev-parse <tag>:app/OmniviewNativeLab/frontend/mock`), and refuses to go on otherwise;
//   2. extracts that tree with `git archive`, so a local edit or a newer commit of the lab never reaches the measurement;
//   3. serves it with the mock's own server.js and runs mock-measure.mjs and mock-table-measure.mjs against it in WebKit and Chromium at both
//      viewports, with the real fonts of the mock on its side (the probes have the kit's on theirs);
//   4. writes the tree hash, the tag and the versions it measured with into each file's `meta`.
// Playwright, its browsers and Node are the ones of this repository; Chromium runs with --font-render-hinting=none (probe-lib.mjs `launch`) so a
// reference made on macOS holds on the Linux runner. Commit the result with the change that needed it. The table's file has a size cap (150 KB):
// a case that is not probed is the first to go when it is near.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES } from './probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = { repository: 'omniviewdev/design-lab', tag: 'spec-baseline-2026-11-16', commit: '108d7049536e52d8d2f48c9a9b8d8cd94886fe81', mockTree: 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0', path: 'app/OmniviewNativeLab/frontend/mock' };

const flag = process.argv.indexOf('--lab');
const lab = (flag === -1 ? undefined : process.argv[flag + 1]) ?? process.env.DESIGN_LAB;
if (lab === undefined) {
  console.error('usage: node packages/kit/probes/generate-reference.mjs --lab <design-lab checkout>');
  process.exit(2);
}

// mock-measure.mjs writes the full reference only when no filter is set; with one it writes mock-reference.partial.json and leaves the file
// this script then certifies untouched. A certified reference is a whole one.
const filters = ['ONLY', 'ENGINE', 'VIEWPORT'].filter((name) => process.env[name]);
if (filters.length > 0) {
  console.error(`unset ${filters.join(', ')}: a filtered run measures part of the reference, and this script certifies the whole file`);
  process.exit(2);
}

const git = (...args) => execFileSync('git', ['-C', lab, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', `${SOURCE.tag}^{commit}`);
const tree = git('rev-parse', `${SOURCE.tag}:${SOURCE.path}`);
if (commit !== SOURCE.commit || tree !== SOURCE.mockTree) {
  console.error(`the checkout's tag ${SOURCE.tag} is commit ${commit} with mock tree ${tree}; this reference is made from ${SOURCE.commit} and ${SOURCE.mockTree}`);
  process.exit(1);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'mock-reference-'));
writeFileSync(path.join(work, 'package.json'), '{"type":"commonjs"}\n'); // the lab's own package.json says "module"; the mock's server.js is CommonJS
execFileSync('sh', ['-c', `git -C "${lab}" archive ${SOURCE.tag} ${SOURCE.path} | tar -x -C "${work}"`]);

const port = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const server = spawn('node', [path.join(work, SOURCE.path, 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => String(chunk).includes('listening') && resolve());
  server.on('exit', (code) => reject(new Error(`the mock server exited with ${code}`)));
});

const measureScripts = ['mock-measure.mjs', 'mock-table-measure.mjs'];
try {
  for (const script of measureScripts) {
    execFileSync('node', [path.join(here, script)], { env: { ...process.env, MOCK_URL: `http://127.0.0.1:${port}/` }, stdio: 'inherit' });
  }
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}

const versions = {};
for (const [name, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch();
  versions[name] = browser.version();
  await browser.close();
}

const measuredWith = { playwright: JSON.parse(readFileSync(path.join(here, '../node_modules/playwright/package.json'), 'utf8')).version, ...versions, platform: `${process.platform}-${process.arch}`, node: process.version };
const generator = (script) => `packages/kit/probes/generate-reference.mjs, running ${script} against the mock served from \`git archive\` of the tag`;

// The parts.
const partsFile = path.join(here, 'mock-reference.json');
const parts = JSON.parse(readFileSync(partsFile, 'utf8'));
parts.meta = {
  source: SOURCE,
  generator: generator('mock-measure.mjs'),
  measuredWith,
  fonts: "the mock's own Inter 3.019 Regular and SemiBold and JetBrains Mono 2.304 Regular; no font is normalized on either side",
  tolerance: 'rectangles within 1 px, everything else exact',
  notes: parts.meta.notes.filter((note) => !/normaliz/i.test(note)),
};
writeFileSync(partsFile, JSON.stringify(parts));
console.log(`wrote ${partsFile} from ${SOURCE.tag} (mock tree ${tree})`);

// The table: its own record format; mock-table-measure.mjs keeps its own `meta` (fonts, notes, the differences between engines), which gains the provenance.
const TABLE_MAX_BYTES = 150 * 1024;
const tableFile = path.join(here, 'mock-table.json');
const table = JSON.parse(readFileSync(tableFile, 'utf8'));
table.meta = { ...table.meta, source: SOURCE, generator: generator('mock-table-measure.mjs'), measuredWith, tolerance: 'heights and y offsets within half a pixel, widths and x offsets within a pixel, every string exact' };
const tableText = JSON.stringify(table);
if (Buffer.byteLength(tableText) > TABLE_MAX_BYTES) {
  console.error(`${tableFile} is ${Buffer.byteLength(tableText)} bytes with its provenance: over its cap of ${TABLE_MAX_BYTES}. Drop a case that is not probed (mock-table-measure.mjs caseList) and run again.`);
  process.exit(1);
}

writeFileSync(tableFile, tableText);
console.log(`wrote ${tableFile} from ${SOURCE.tag} (mock tree ${tree}), ${Buffer.byteLength(tableText)} bytes`);
