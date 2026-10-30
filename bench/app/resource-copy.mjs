#!/usr/bin/env node
// Dense plain resource arrays only. This is JavaScript work, not native process CPU.
import { build } from 'esbuild';
import { webkit } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const source = new URL('../../packages/omniviewdev-runtime/src/hooks/resource/useEventBatcher.ts', import.meta.url);
const sourcePath = fileURLToPath(source);
const contents = await readFile(source, 'utf8');
const copies = contents.match(/\[\.\.\.original\]|original\.slice\(\)/g) ?? [];
assert.equal(copies.length, 3, 'Review the production copy sites before adapting benchmark variants');
const variants = {};
for (const method of ['spread', 'slice', 'loop']) {
  let input = contents.replaceAll('original.slice()', '[...original]');
  if (method === 'slice') input = input.replaceAll('[...original]', 'original.slice()');
  if (method === 'loop') input = `function copyRows(rows: unknown[]) { const copy = new Array(rows.length); for (let i = 0; i < rows.length; i++) copy[i] = rows[i]; return copy; }\n` + input.replaceAll('[...original]', 'copyRows(original)');
  const bundle = await build({ stdin: { contents: input, resolveDir: dirname(sourcePath), sourcefile: sourcePath, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: '__copyVariant', define: { 'process.env.NODE_ENV': '"production"' } });
  variants[method] = bundle.outputFiles[0].text + `\nwindow.__reducers.${method} = __copyVariant.applyBatch;`;
}
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  await page.evaluate(() => { window.__reducers = {}; });
  for (const code of Object.values(variants)) await page.addScriptTag({ content: code });
  const samples = await page.evaluate(() => {
    const samples = [];
    let checksum = 0;
    window.__copySink = new Array(8);
    const methods = ['spread', 'slice', 'loop'];
    const copy = {
      spread: rows => [...rows],
      slice: rows => rows.slice(),
      loop: rows => { const out = new Array(rows.length); for (let i = 0; i < rows.length; i++) out[i] = rows[i]; return out; },
    };
    for (const count of [300, 3000, 10000]) {
      const rows = Array.from({ length: count }, (_, i) => ({ metadata: { name: `pod-${i}` }, status: { revision: 0 } }));
      const base = { result: rows, success: true, totalCount: count };
      for (const workload of ['copy-only', 'update-one', 'update-all']) {
        const changed = workload === 'update-one' ? rows.slice(-1) : rows;
        const events = changed.map(row => ({ type: 'UPDATE', payload: { data: { ...row, status: { revision: 1 } } } }));
        let iterations = workload === 'copy-only' ? Math.max(100, Math.floor(3000000 / count)) : Math.max(20, Math.floor(100000 / count));
        const results = Object.fromEntries(methods.map(method => [method, []]));
        function run(method, times) {
          const fn = workload === 'copy-only' ? () => copy[method](rows) : () => window.__reducers[method](base, events, 'metadata.name').result;
          let out;
          const started = performance.now();
          for (let i = 0; i < times; i++) { out = fn(); window.__copySink[i % 8] = out; checksum += out.length + out.at(-1).status.revision; }
          const elapsed = performance.now() - started;
          if (out.length !== count || rows.at(-1).status.revision !== 0 || (workload !== 'copy-only' && out.at(-1).status.revision !== 1)) throw new Error('Variant changed reducer behavior');
          window.__lastCopy = out; // Retain output so allocation escape remains observable.
          return elapsed / times;
        }
        for (const method of methods) run(method, iterations * 3);
        // WebKit may quantize timers to 1 ms; aggregate enough work per sample.
        const calibrationMs = Math.min(...methods.map(method => run(method, iterations) * iterations));
        iterations *= Math.max(1, Math.ceil(50 / Math.max(1, calibrationMs)));
        // Rotate order to reduce fixed-order JIT, GC, and thermal bias.
        for (let round = 0; round < 15; round++) for (let offset = 0; offset < methods.length; offset++) {
          const method = methods[(round + offset) % methods.length];
          results[method].push(run(method, iterations));
        }
        for (const method of methods) {
          const sorted = [...results[method]].sort((a,b) => a-b);
          samples.push({ count, workload, method, iterationsPerSample: iterations, medianMs: sorted[7], millisecondsPerOperation: results[method] });
        }
      }
    }
    return { samples, checksum };
  });
  const report = { scope: 'Playwright WebKit JavaScript engine, dense plain arrays and production reducer variants; not actual Wails WebView, render, GPU, or native CPU', at: new Date().toISOString(), engine: 'WebKit', engineVersion: browser.version(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, sourceSHA256: createHash('sha256').update(contents).digest('hex'), ...samples };
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
