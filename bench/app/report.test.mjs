import assert from 'node:assert/strict';
import test from 'node:test';

import { summarize } from './report.mjs';

const results = { pods: [{ open: { wallMs: 10 }, scroll: { wallMs: 20, steps: 31 } }] };
const legacy = { commit: 'abc1234', dirty: false, k8sPlugin: 'def5678', chromium: '1', host: 'test host', runs: 1 };

test('a result without a workload id is an unknown legacy workload, never the 5,000-record collection', () => {
  const summary = summarize({ meta: legacy, results });
  assert.match(summary, /unknown legacy workload/);
  assert.doesNotMatch(summary, /5,000/);
  assert.doesNotMatch(summary, /source-view collection/);
});

test('a recorded workload is described from its recorded parameters, not a fixed size', () => {
  const workload = { id: 'whole-app/v1', pods: { records: 1234, scrollPages: 7 } };
  const summary = summarize({ meta: { ...legacy, workload }, results });
  assert.match(summary, /Workload whole-app\/v1/);
  assert.match(summary, /7 viewport steps through a complete source-view collection of 1,234 records/);
  assert.doesNotMatch(summary, /5,000/);
  assert.doesNotMatch(summary, /unknown legacy/);
});

test('an unrecognized workload id makes no claim about how its records are delivered', () => {
  const workload = { id: 'whole-app/v9', pods: { records: 20, scrollPages: 3 } };
  const summary = summarize({ meta: { ...legacy, workload }, results });
  assert.match(summary, /through a corpus of 20 records/);
  assert.doesNotMatch(summary, /source-view collection/);
});

test('an unidentified plugin checkout is reported as unknown with its reason, never as a commit', () => {
  const meta = {
    ...legacy,
    dirty: null,
    k8sPlugin: 'unknown',
    workload: { id: 'whole-app/v1', pods: { records: 5000, scrollPages: 30 } },
    frontend: { config: 'bench/app/vite.config.ts', reactDom: 'react-dom/profiling', rebuilt: false },
    hostSource: { state: 'unknown', reason: 'git could not resolve HEAD of the selected checkout' },
    plugin: {
      checkout: { state: 'unknown', reason: 'the selected plugin metadata resolves to the host repository' },
      bundle: { treeSHA256: 'f'.repeat(64) },
    },
  };
  const summary = summarize({ meta, results });
  assert.match(summary, /kubernetes plugin unknown, bundle sha256 ffffffffffff,/);
  assert.match(summary, /kubernetes plugin source is unknown: the selected plugin metadata resolves to the host repository/);
  assert.match(summary, /Commit abc1234 \(dirty state unknown\)/);
  assert.match(summary, /host source is unknown/);
  assert.match(summary, /reused from an earlier build/);
  assert.match(summary, /profiling overhead/);
});

test('a legacy plugin commit is flagged as unverified', () => {
  assert.match(summarize({ meta: legacy, results }), /not verified as a separate checkout/);
});

