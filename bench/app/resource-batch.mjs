#!/usr/bin/env node
// Measures the production cache reducer only, not native WebView or cluster CPU.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = new URL('../../packages/omniviewdev-runtime/src/hooks/resource/useEventBatcher.ts', import.meta.url);
const runtimeSourcePath = fileURLToPath(source);
const sourcePath = process.argv[3] ? resolve(process.argv[3]) : runtimeSourcePath;
const sourceBytes = await readFile(sourcePath, 'utf8');
const bundled = await build({ stdin: { contents: sourceBytes, sourcefile: runtimeSourcePath, resolveDir: dirname(runtimeSourcePath), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { applyBatch } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const samples = [];
for (const count of [300, 3000, 10000]) {
  const rows = Array.from({ length: count }, (_, i) => ({ metadata: { name: `pod-${i}`, namespace: 'default' }, status: { phase: 'Running', revision: 0 } }));
  const base = { result: rows, success: true, totalCount: count };
  for (const workload of ['update-one', 'update-all', 'delete-all', 'duplicate-adds']) {
    const events = (workload === 'update-one' ? rows.slice(-1) : rows).map((row) => ({
      type: workload === 'delete-all' ? 'DELETE' : workload === 'duplicate-adds' ? 'ADD' : 'UPDATE',
      payload: { data: { ...row, status: { ...row.status, revision: 1 } }, id: row.metadata.name, namespace: 'default', key: 'core::v1::Pod', connection: 'benchmark' },
    }));
    const check = applyBatch(base, events, 'metadata.name');
    assert.equal(check.result.length, workload === 'delete-all' ? 0 : count);
    assert.ok(rows.every(row => row.status.revision === 0), 'Cached rows must remain unchanged');
    if (workload === 'update-all') assert.ok(check.result.every(row => row.status.revision === 1), 'Every updated row must carry the new revision');
    if (workload === 'update-one') {
      assert.equal(check.result.at(-1).status.revision, 1);
      assert.ok(check.result.slice(0, -1).every(row => row.status.revision === 0), 'A single update must not change other rows');
    }
    if (workload === 'duplicate-adds') assert.ok(check.result.every(row => row.status.revision === 0), 'Duplicate ADDs must not replace existing rows');
    for (let warmup = 0; warmup < 3; warmup++) applyBatch(base, events, 'metadata.name');
    const milliseconds = [];
    for (let repeat = 0; repeat < 9; repeat++) {
      const started = performance.now();
      applyBatch(base, events, 'metadata.name');
      milliseconds.push(performance.now() - started);
    }
    const sorted = [...milliseconds].sort((a, b) => a - b);
    samples.push({ count, workload, events: events.length, medianMs: sorted[4], milliseconds });
  }
}
const report = { scope: 'Production applyBatch reducer; synthetic pods, no bridge, React, graphics, or native CPU claim', at: new Date().toISOString(), node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, sourcePath, sourceSHA256: createHash('sha256').update(sourceBytes).digest('hex'), samples };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
