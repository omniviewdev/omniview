import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scripts = path.dirname(fileURLToPath(import.meta.url));
function run(script, cwd, environment, ...args) {
  const child = spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd, env: { ...process.env, ...environment }, encoding: 'utf8',
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
}

test('real esbuild worker producer writes selected file without touching tracked destination', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'omniview worker stage '));
  try {
    const entry = path.join(root, 'node_modules/monaco-yaml');
    const canonical = path.join(root, 'ui/providers/monaco/yaml.worker.bundle.js');
    const output = path.join(root, 'owned sibling stage/yaml.worker.bundle.js');
    mkdirSync(entry, { recursive: true });
    mkdirSync(path.dirname(canonical), { recursive: true });
    writeFileSync(path.join(entry, 'yaml.worker.js'), 'self.workerSmoke = "a15-real-esbuild";\n');
    writeFileSync(canonical, 'tracked current source\n');
    run('bundle-yaml-worker.mjs', root, { OMNIVIEW_YAML_WORKER_OUTPUT_FILE: output });
    assert.match(readFileSync(output, 'utf8'), /a15-real-esbuild/);
    assert.equal(readFileSync(canonical, 'utf8'), 'tracked current source\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
