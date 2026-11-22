// The unavailable API group's side of the Pods cluster check (INV4, the demo's finding O2, plugin omniview-plugin-kubernetes#281): one aggregated API that cannot answer (metrics-server down is the usual one)
// must not keep a person out of a working cluster. Before #281 the plugin installed a `partial` catalog and the host refused the connection ("Connection admission requires complete discovered support."): the
// first Pods page of a fresh connection failed, and Retry worked. Now the connection starts, the catalog is complete for every group that answered, and the plugin names the groups that did not in the
// connection fact `kubernetes.unavailable_api_groups`.
// Pure functions only (no process, no browser), so `unavailable.test.mjs` proves each failure mode without a cluster. The cluster and the page are `checkUnavailableGroup` in parity.mjs.
import { fileURLToPath } from 'node:url';

/** The made-up API group the check registers (unavailable-group.yaml): a Service with no endpoints behind an APIService. */
export const GROUP = 'inv4-unavailable.example.com';
export const VERSION = 'v1beta1';
export const GROUP_VERSION = `${GROUP}/${VERSION}`;
export const APISERVICE = `${VERSION}.${GROUP}`;
export const MANIFEST = fileURLToPath(new URL('./unavailable-group.yaml', import.meta.url));

/** The connection fact in which the plugin names the API group versions it could not read (plugin README, "Connection/server metadata"). It is absent while every group answers. */
export const FACT = 'kubernetes.unavailable_api_groups';

/** The reason the plugin gives it: a current server's aggregated discovery marks every broken APIService `Stale` (plugin docs, "When is the catalog partial?"); the cluster of the check is one. */
export const REASON = 'stale';

/** `kubectl get apiservice <name> -o jsonpath=...` that prints `<status>/<reason>` of the APIService's Available condition. */
export const AVAILABLE_JSONPATH = '{.status.conditions[?(@.type=="Available")].status}/{.status.conditions[?(@.type=="Available")].reason}';

/**
 * What the cluster must hold before the host connects: the APIService, Available=False because its Service has no endpoints. `printed` is what `AVAILABLE_JSONPATH` printed, or `undefined` when kubectl
 * found no such APIService. Returns the problems as readable lines; empty when the group is registered and cannot answer. What cannot be read is a problem, never a pass.
 */
export function compareAvailability(printed) {
  if (printed === undefined) {
    return [`the cluster has no APIService ${APISERVICE}`];
  }
  const text = String(printed).trim();
  if (text !== 'False/MissingEndpoints') {
    return [`the APIService ${APISERVICE} is not Available=False because of missing endpoints (its Available condition prints ${JSON.stringify(text)})`];
  }
  return [];
}

/**
 * The requests the page made that the host refused (status 400 or more), as readable lines, without the page's own cancellation. A 422 answered CANCELLED is a query the page cancelled itself when the
 * connection's readiness changed: Chromium's first load of the Pods page shows one in about one load of three on a healthy cluster with the plugin before #281 (the unchanged plugin, no unavailable group),
 * and the host's allow-list for failed requests (ui-next/plugins/e2e/seam.check.mjs) is explicit for the same reason. Anything else, the 422 of an admission the host refused among them, is a refusal.
 *   failures   { status, method, path, asked, answered } of each response of 400 or more
 */
export function refusedRequests(failures) {
  return failures
    .filter((failure) => !(failure.status === 422 && /CANCELLED/.test(failure.answered ?? '')))
    .map((failure) => `${failure.method} ${failure.path} -> ${String(failure.status)}: asked ${failure.asked} | answered ${failure.answered}`);
}

/** The fact's value as an object: the host hands it over as the JSON the plugin put there, an object, or (an older shape) the text of one. */
function factValue(entry) {
  if (typeof entry.value === 'string') {
    try {
      return JSON.parse(entry.value);
    } catch {
      return undefined;
    }
  }
  return entry.value;
}

/**
 * What the host's connection facts must say once the plugin has read a cluster with one unavailable group: the fact `kubernetes.unavailable_api_groups` is there, current, and names exactly the one group
 * version of the check, with the reason a current server gives, and counts it. `metadata` is what `ServiceWrapper.GetConnectionMetadata` returns for the connection (the host's envelope: `supported`,
 * `transportAvailable`, `snapshot.entries`). Returns the problems as readable lines; empty when the facts name the group. What cannot be read is a problem, never a pass.
 */
export function compareFacts(metadata) {
  if (metadata === null || typeof metadata !== 'object') {
    return ['the host returned no connection metadata'];
  }
  if (metadata.supported !== true) {
    return ['the host says the plugin does not support connection metadata, so no fact can be read'];
  }
  const entries = metadata.snapshot?.entries;
  if (entries === null || typeof entries !== 'object') {
    return [`the host's connection metadata carries no facts (transportAvailable ${String(metadata.transportAvailable)})`];
  }
  const entry = entries[FACT];
  if (entry === undefined) {
    return [`the connection has no fact ${FACT}: the plugin named no unavailable group (the facts it has: ${Object.keys(entries).join(', ') || 'none'})`];
  }
  const problems = [];
  if (entry.state !== 'current') {
    problems.push(`the fact ${FACT} is "${String(entry.state)}", not current`);
  }
  const value = factValue(entry);
  if (value === null || typeof value !== 'object' || !Array.isArray(value.groups)) {
    problems.push(`the fact ${FACT} is not {count, groups}: ${JSON.stringify(entry.value)}`);
    return problems;
  }
  const named = value.groups.map((group) => `${String(group?.groupVersion)} (${String(group?.reason)})`);
  const wanted = `${GROUP_VERSION} (${REASON})`;
  if (named.length !== 1 || named[0] !== wanted) {
    problems.push(`the fact ${FACT} names ${named.length === 0 ? 'no group' : named.join(', ')}; the cluster's one unavailable group is ${wanted}`);
  }
  if (value.count !== 1) {
    problems.push(`the fact ${FACT} counts ${JSON.stringify(value.count)} unavailable group versions; the cluster has 1`);
  }
  return problems;
}
