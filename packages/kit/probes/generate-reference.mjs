// Regenerates `mock-reference.json`, the pinned copy of the design mock's values that kit-probe.mjs (and CI) compare the kit with.
//
//   node packages/kit/probes/generate-reference.mjs --lab <a checkout of the private repository omniviewdev/design-lab>
//
// The design lab is private and is only needed here, never in CI. The script
//   1. checks the checkout holds tag spec-baseline-2026-11-16 (commit 108d7049...) and that the mock at that tag is the tree c8e44a44...
//      (`git rev-parse <tag>:app/OmniviewNativeLab/frontend/mock`), and refuses to go on otherwise;
//   2. extracts that tree with `git archive`, so a local edit or a newer commit of the lab never reaches the measurement;
//   3. serves it with the mock's own server.js and runs mock-measure.mjs against it in WebKit and Chromium at both viewports, with the real
//      fonts of the mock on its side (the kit's probe has the kit's on its side);
//   4. writes the tree hash, the tag and the versions it measured with into the file's `meta`.
// Playwright, its browsers and Node are the ones of this repository; Chromium runs with --font-render-hinting=none (probe-lib.mjs `launch`) so a
// reference made on macOS holds on the Linux runner. Commit the result with the change that needed it.
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

try {
  execFileSync('node', [path.join(here, 'mock-measure.mjs')], { env: { ...process.env, MOCK_URL: `http://127.0.0.1:${port}/` }, stdio: 'inherit' });
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}

const file = path.join(here, 'mock-reference.json');
const reference = JSON.parse(readFileSync(file, 'utf8'));
const versions = {};
for (const [name, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch();
  versions[name] = browser.version();
  await browser.close();
}

reference.meta = {
  source: SOURCE,
  generator: 'packages/kit/probes/generate-reference.mjs, running mock-measure.mjs against the mock served from `git archive` of the tag',
  measuredWith: { playwright: JSON.parse(readFileSync(path.join(here, '../node_modules/playwright/package.json'), 'utf8')).version, ...versions, platform: `${process.platform}-${process.arch}`, node: process.version },
  fonts: "the mock's own Inter 3.019 Regular and SemiBold and JetBrains Mono 2.304 Regular; no font is normalized on either side",
  tolerance: 'rectangles within 1 px, everything else exact',
  notes: reference.meta.notes.filter((note) => !/normaliz/i.test(note)),
};
writeFileSync(file, JSON.stringify(reference));
console.log(`wrote ${file} from ${SOURCE.tag} (mock tree ${tree})`);
