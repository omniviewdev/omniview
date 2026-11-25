// The local wrapper of the checks that do not run on a pull request (scripts/ci/local-checks.mjs, N34): which units a diff touches, what a seam run does for the units named, and that a dry run starts nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INHERITED, cleanEnv, main, probeUnitsOf, seamPlanOf, withSiblings } from './local-checks.mjs';

const UNITS = [
  { id: 'a', file: 'scripts/ci/probe-units/a.mjs', script: 'ui-next/shell/probes/a-probe.mjs' },
  { id: 'a-controls', file: 'scripts/ci/probe-units/a.mjs', script: 'ui-next/shell/probes/a-probe.mjs', controls: ['x'] },
  { id: 'b', file: 'scripts/ci/probe-units/b.mjs', script: 'ui-next/shell/probes/b-probe.mjs' },
];

test('a unit file, a probe script and a file a probe script names are placed in their units; a shared file of the CI scripts is not placed', () => {
  const read = (file) => (file === 'ui-next/shell/probes/b-probe.mjs' ? "import './b-fixture.tsx';" : null);
  assert.deepEqual(probeUnitsOf(['scripts/ci/probe-units/a.mjs'], UNITS, read), { ids: ['a', 'a-controls'], unknown: [] });
  assert.deepEqual(probeUnitsOf(['ui-next/shell/probes/b-probe.mjs'], UNITS, read), { ids: ['b'], unknown: [] });
  assert.deepEqual(probeUnitsOf(['ui-next/shell/probes/b-fixture.tsx'], UNITS, read), { ids: ['b'], unknown: [] });
  assert.deepEqual(probeUnitsOf(['ui-next/shell/probes/orphan.mjs'], UNITS, read), { ids: [], unknown: ['ui-next/shell/probes/orphan.mjs'] });
  assert.deepEqual(probeUnitsOf(['scripts/ci/probe-shards.mjs', 'ui-next/shell/Thing.tsx'], UNITS, read), { ids: [], unknown: ['scripts/ci/probe-shards.mjs'] });
});

test('a unit is run with the controls of its probe script, and none of another', () => {
  assert.deepEqual(withSiblings(['a'], UNITS), ['a', 'a-controls']);
  assert.deepEqual(withSiblings(['b'], UNITS), ['b']);
});

test('a seam run is the phases of the units named, then the controls of the units named; a name that is no unit is an error', () => {
  const table = [{ id: 'p', phases: ['x', 'y'] }, { id: 'c', runs: ['one', 'two'] }];
  assert.deepEqual(seamPlanOf(['p', 'c'], table), { phases: ['x', 'y'], runs: ['one', 'two'] });
  assert.throws(() => seamPlanOf(['nope'], table), /no seam unit "nope"/);
});

test('a dry run prints the commands and starts nothing; a missing or unknown unit is exit 2', async () => {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (text) => { written.push(String(text)); return true; };
  try {
    assert.equal(await main(['probes', 'tour', '--dry']), 0);
    assert.equal(await main(['seam', 'ports', '--dry']), 0);
  } finally {
    process.stdout.write = write;
  }
  const text = written.join('');
  // The probes and the seam read the NEXT UI: every build command names it.
  assert.match(text, /\+ OMNIVIEW_UI=next task packages/);
  assert.match(text, /\+ OMNIVIEW_UI=next OMNIVIEW_BUILD_OUTPUT_DIRECTORY=\S+ pnpm exec vite build/);
  assert.doesNotMatch(text, /\+ task packages/);
  assert.match(text, /probe-shards\.mjs run local tour/);
  assert.match(text, /ENGINES=webkit SEAM_PHASES=ports node ui-next\/plugins\/e2e\/seam\.check\.mjs/);
  assert.match(text, /ENGINES=chromium SEAM_PHASES=ports/);
  const errors = [];
  const writeError = process.stderr.write.bind(process.stderr);
  process.stderr.write = (text2) => { errors.push(String(text2)); return true; };
  try {
    assert.equal(await main(['probes', 'no-such-unit', '--dry']), 2);
    assert.equal(await main(['seam']), 2);
    assert.equal(await main([]), 2);
  } finally {
    process.stderr.write = writeError;
  }
});

test('the selectors a shell left behind (SEAM_PHASES, SEAM_CONTROL, SEAM_ONLY, SEAM_REMOVE, ENGINES) never reach a child: only the invocation sets them', () => {
  const base = { PATH: '/bin', HOME: '/h', SEAM_PHASES: 'x', SEAM_CONTROL: 'y', SEAM_ONLY: 'z', SEAM_REMOVE: 'w', ENGINES: 'webkit' };
  assert.deepEqual(cleanEnv(base), { PATH: '/bin', HOME: '/h' });
  assert.deepEqual(INHERITED.sort(), ['ENGINES', 'SEAM_CONTROL', 'SEAM_ONLY', 'SEAM_PHASES', 'SEAM_REMOVE']);
  const saved = Object.fromEntries(INHERITED.map((name) => [name, process.env[name]]));
  for (const name of INHERITED) process.env[name] = 'left-over';
  try {
    assert.deepEqual(INHERITED.filter((name) => name in cleanEnv()), []);
  } finally {
    for (const name of INHERITED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
