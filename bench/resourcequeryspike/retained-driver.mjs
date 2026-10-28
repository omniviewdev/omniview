// Replay committed retained evidence against the explicitly selected fork only.
// Historical unsafe expectations are replaced ONLY by already recorded exact
// semanticExpected values, or the three named schema numeric corrections.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const commands = [];
function run(binary, args, cwd, options = {}) {
  const child = spawnSync(binary, args, { cwd, env: { ...process.env, GOWORK: 'off' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, input: options.input });
  assert.equal(child.error, undefined);
  commands.push({ binary, args, status: child.status, stdout: child.stdout, stderr: child.stderr });
  if (!options.allowFailure) assert.equal(child.status, 0, child.stderr + child.stdout);
  return child;
}
const selected = JSON.parse(run('go', ['list', '-m', '-json', 'cel.dev/cel-go'], process.cwd()).stdout);
assert.equal(selected.Replace?.Path, 'github.com/omniviewdev/cel-go', 'explicitly approved immutable Omniview fork must be selected');
assert.match(selected.Replace.Version, /^v\d+\.\d+\.\d+(?:-\d{14}-[0-9a-f]{12}|-0\.\d{14}-[0-9a-f]{12})$/, 'immutable Go pseudo-version required');
const replacement = `cel.dev/cel-go=${selected.Replace.Path}@${selected.Replace.Version}`;
const root = await mkdtemp(join(tmpdir(), 'p01-candidate-retained-'));
const archives = {};
const results = {};
try {
  for (const [name, file] of Object.entries({ numeric: '2026-10-17-cel-numeric-evidence.zip', nullable: '2026-10-17-cel-nullable-evidence.zip', confirmation: '2026-10-17-cel-confirmation-evidence.zip' })) {
    const archive = resolve('../../docs/superpowers/specs', file);
    archives[name] = { file, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
    run('unzip', ['-q', archive, '-d', join(root, name)], process.cwd());
  }
  function select(directory) {
    run('go', ['mod', 'edit', `-replace=${replacement}`], directory);
    run('go', ['mod', 'tidy'], directory);
    const module = JSON.parse(run('go', ['list', '-m', '-json', 'cel.dev/cel-go'], directory).stdout);
    assert.equal(module.Replace.Path, selected.Replace.Path);
    assert.equal(module.Replace.Version, selected.Replace.Version);
  }
  const numeric = join(root, 'numeric');
  select(numeric);
  for (const [name, args, count, rejected] of [['native', [], 64, 0], ['typed', ['-cross-type'], 72, 4]]) {
    run('go', ['run', '.', '-mode', 'native', ...args, '-out', `${name}.json`], numeric);
    const output = JSON.parse(await readFile(join(numeric, `${name}.json`), 'utf8'));
    assert.equal(output.count, count);
    assert.equal(output.mathematicalMismatches, 0);
    assert.equal(output.rejections, 0);
    assert.equal(output.expectedCompileRejections, rejected);
    assert.equal(output.scalarOracleChecks, 100816);
    assert.equal(output.scalarOraclePairFailures, 0);
    results[`numeric-${name}`] = output;
  }
  const bindings = join(root, 'confirmation', 'bindings');
  const archived = JSON.parse(await readFile(join(bindings, 'results.json'), 'utf8'));
  const payload = await readFile(join(bindings, 'requests.jsonl'), 'utf8');
  const requests = payload.trim().split('\n').map(line => JSON.parse(line));
  select(bindings);
  run('go', ['build', '-o', 'evaluator', '.'], bindings);
  const child = run(join(bindings, 'evaluator'), [], bindings, { input: payload });
  const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, archived.checks.length);
  const checks = responses.map((actual, index) => {
    const prior = archived.checks[index];
    const request = requests[index];
    assert.equal(actual.id, prior.id);
    const expected = request.semanticExpected ? { stage: 'result', value: request.semanticExpected } : prior.expected;
    assert.equal(actual.stage, expected.stage, prior.id);
    if ('value' in expected) assert.deepEqual(actual.value, expected.value, prior.id);
    return { id: prior.id, expected, actual };
  });
  results.bindings = { count: checks.length, checks };
  const correctedSchemaCases = new Set(['dynamic mixed-domain false equality unsafe', 'dynamic mixed-domain literal false equality unsafe', 'dynamic resource cannot bypass numeric issue']);
  for (const [name, relative] of [['schema', 'confirmation/schema'], ['nullable', 'nullable/admission'], ['builder', 'nullable/builder']]) {
    const directory = join(root, relative);
    select(directory);
    const child = run('go', ['run', '.'], directory, { allowFailure: name === 'schema' });
    const output = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
    for (const observation of output.observations) {
      const expected = name === 'schema' && correctedSchemaCases.has(observation.name) ? 'false' : observation.expected;
      assert.equal(observation.actual, expected, `${name}: ${observation.name}`);
      if (!(name === 'schema' && correctedSchemaCases.has(observation.name))) assert.equal(observation.assertion, true, `${name}: ${observation.name}`);
    }
    if (name === 'schema') {
      assert.equal(output.observations.filter(row => correctedSchemaCases.has(row.name)).length, 3);
      assert.equal(child.status, 1, 'archived schema runner retains three deliberately unsafe historical expected results');
    } else assert.equal(child.status, 0);
    results[name] = output;
  }
} finally {
  await rm(root, { recursive: true });
}
  await writeFile('retained-results.json', JSON.stringify({ selected, archives, results, commands, privateCheckoutRemoved: true }, null, 2) + '\n');
console.log(`Retained corrected-candidate conformance passed: numeric native64/typed72/oracle100816 each; bindings${results.bindings.count}; schema${results.schema.observations.length}; nullable${results.nullable.observations.length}; builder${results.builder.observations.length}`);
