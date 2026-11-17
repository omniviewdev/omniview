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
