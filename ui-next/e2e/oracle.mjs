// The oracle side of the Pods cluster check: what `kubectl get pods -A` says, what the fixture must contain, and how a page differs from it.
// Pure functions only (no process, no browser), so `oracle.test.mjs` can prove each failure mode without a cluster.

// What docs/ui-next/slices/1a-pods-list/fixture.yaml creates (a Pod name is `<prefix><generated suffix>` for controller-made Pods, exact otherwise).
// A cluster that lacks any of these is "empty" for the purposes of the check: kind's own kube-system Pods alone must never satisfy it.
export const FIXTURE_PODS = [
  { namespace: 'checkout', prefix: 'cart-api-', count: 3 },
  { namespace: 'checkout', prefix: 'payment-gateway-', count: 2 },
  { namespace: 'checkout', name: 'cart-cache-0' },
  { namespace: 'checkout', name: 'cart-cache-1' },
  { namespace: 'checkout', name: 'bad-image' },
  { namespace: 'checkout', name: 'unschedulable' },
  { namespace: 'checkout', name: 'crashloop' },
  { namespace: 'monitoring', prefix: 'node-agent-', count: 1 },
  { namespace: 'monitoring', prefix: 'alertmanager-', count: 1 },
  { namespace: 'batch', prefix: 'nightly-report-', count: 3 },
  { namespace: 'batch', prefix: 'broken-migration-', count: 1 },
];

// `kubectl get pods -A --no-headers -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name` -> sorted `namespace/name`.
export function parseKubectlPods(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [namespace, name, ...rest] = line.split(/\s+/);
      if (namespace === undefined || name === undefined || rest.length > 0) {
        throw new Error(`unexpected kubectl line: ${JSON.stringify(line)}`);
      }
      return `${namespace}/${name}`;
    })
    .sort();
}

// `kubectl get pods -A --no-headers`, the printer's own table (NAMESPACE NAME READY STATUS RESTARTS AGE) -> one row per Pod, sorted by `namespace/name`.
// RESTARTS may read `15 (3m ago)`: only the four leading columns are read, and none of them holds a space.
export function parseKubectlTable(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [namespace, name, ready, status] = line.split(/\s+/);
      if (namespace === undefined || name === undefined || ready === undefined || status === undefined || !/^\d+\/\d+$/.test(ready)) {
        throw new Error(`unexpected kubectl line: ${JSON.stringify(line)}`);
      }
      return { name: `${namespace}/${name}`, ready, status };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// The page's quick filters by the plan's rule (docs/ui-next/slices/1a-pods-list.md 1.3), applied to kubectl's own STATUS words: Running is the word,
// Pending is the role `progress`, Failed is the role `error`, Completed is two words. This is the oracle's own table, not the page's: the two agree
// only when the page's table does. `other` is in All and in no filter.
const FILTER_WORDS = {
  running: ['Running'],
  completed: ['Completed', 'Succeeded'],
  pending: ['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating'],
  failed: [
    'CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'OOMKilled', 'Evicted', 'NotReady',
    'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError', 'InvalidImageName', 'ContainerCannotRun', 'DeadlineExceeded',
  ],
  other: ['Unknown', 'Terminated'],
};

function classify(word) {
  for (const [filter, words] of Object.entries(FILTER_WORDS)) {
    if (words.includes(word)) {
      return filter;
    }
  }
  return undefined;
}

// A word the oracle does not know stops the check: a guessed filter would let the page and the oracle agree on a wrong count.
export function quickFilterOf(status) {
  const known = classify(status);
  if (known !== undefined) {
    return known;
  }
  if (/^Init:\d+\/\d+$/.test(status)) {
    return 'pending';
  }
  if (status.startsWith('Init:')) {
    // An init container's failure takes the role of what follows `Init:`, and one the table has no word for is an error.
    return classify(status.slice('Init:'.length)) ?? 'failed';
  }
  throw new Error(`cannot classify the STATUS word ${JSON.stringify(status)}: read what the page's status table says and add it here`);
}

export function quickFilterCounts(rows) {
  const counts = { all: rows.length, running: 0, pending: 0, failed: 0, completed: 0 };
  for (const row of rows) {
    const filter = quickFilterOf(row.status);
    if (filter !== 'other') {
      counts[filter] += 1;
    }
  }
  return counts;
}

// The strip's chips as the page prints them, in its order: the label and the count.
export function chipTexts(counts) {
  return [`All ${String(counts.all)}`, `Running ${String(counts.running)}`, `Pending ${String(counts.pending)}`, `Failed ${String(counts.failed)}`, `Completed ${String(counts.completed)}`];
}

// The fixture entries the Pod names do not satisfy, as readable lines; empty when the fixture is fully present.
export function fixtureGaps(names) {
  const gaps = [];
  for (const wanted of FIXTURE_PODS) {
    if (wanted.name !== undefined) {
      if (!names.includes(`${wanted.namespace}/${wanted.name}`)) {
        gaps.push(`${wanted.namespace}/${wanted.name}`);
      }
      continue;
    }
    const found = names.filter((name) => name.startsWith(`${wanted.namespace}/${wanted.prefix}`)).length;
    if (found !== wanted.count) {
      gaps.push(`${wanted.namespace}/${wanted.prefix}*: want ${String(wanted.count)}, found ${String(found)}`);
    }
  }
  return gaps;
}

// Both lists are sorted `namespace/name`; the result is empty exactly when the page shows the oracle's Pods and no others.
export function diffNames(pageNames, oracleNames) {
  const page = new Set(pageNames);
  const oracle = new Set(oracleNames);
  return {
    missing: oracleNames.filter((name) => !page.has(name)),
    extra: pageNames.filter((name) => !oracle.has(name)),
    duplicated: pageNames.filter((name, index) => pageNames.indexOf(name) !== index),
  };
}

export function isAgreement(diff) {
  return diff.missing.length === 0 && diff.extra.length === 0 && diff.duplicated.length === 0;
}

// A failure of the check itself, with a code the negative controls assert on so that an infrastructure error is never mistaken for a detected defect.
export class ParityError extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ParityError';
    this.code = code;
    this.detail = detail;
  }
}
