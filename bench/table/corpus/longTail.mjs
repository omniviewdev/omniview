// A long-tailed set of Pod rows for the table bench: the SAME row shape as `podRows.mjs` (`{ key, name, namespace, nameTail, ready, status,
// restarts, createdAt, node, ip }`) with the variety a real cluster of that size has and the kind corpus lacks (5,000 of its 5,025 Pods are
// copies of one Pending shape: one namespace, one name stem, no node, no address, no restarts).
//
// What is modelled, each from what `kubectl get pods -A` of a production cluster looks like:
//   - names: Deployment Pods (`<stem>-<replicaset hash 10>-<suffix 5>`), StatefulSet Pods (`<stem>-<ordinal>`), DaemonSet Pods (`<stem>-<suffix 5>`)
//     and CronJob Pods (`<stem>-<minutes 8>-<suffix 5>`): lengths from 9 to 63, the way the API server generates them;
//   - namespaces: a long tail (a few namespaces hold most Pods), names from 4 to 36 characters;
//   - status words by their real frequency (Running about nine in ten), Ready counts from 1 to 4 containers, restarts with a heavy tail
//     (0 for most, up to four digits for a crash loop), nodes with long cloud host names, a Pod IP, ages from seconds to over a year.
// It is seeded: the same seed is the same rows. It is synthetic, so a measurement on it is diagnostic, never an identity.
import { nameTail, stateRole } from './podRows.mjs';
import { rng } from './updates.mjs';

const WORDS = [
  'api', 'auth', 'billing', 'cache', 'catalog', 'checkout', 'cron', 'dashboard', 'db', 'edge', 'events', 'exporter', 'gateway', 'indexer', 'ingest',
  'ledger', 'mailer', 'metrics', 'notifier', 'orders', 'payments', 'proxy', 'queue', 'recommender', 'redis', 'render', 'reports', 'router',
  'scheduler', 'search', 'sessions', 'shipping', 'sync', 'thumbnailer', 'tracing', 'uploader', 'users', 'webhook', 'worker', 'frontend',
];
const QUALIFIERS = ['primary', 'canary', 'blue', 'green', 'batch', 'realtime', 'internal', 'public', 'eu', 'us', 'ap', 'v2', 'legacy', 'beta'];
const NAMESPACE_STEMS = ['kube-system', 'monitoring', 'ingress', 'cert-manager', 'logging', 'tracing', 'data', 'platform', 'payments', 'checkout', 'search', 'ml'];
const SUFFIX = 'bcdfghjklmnpqrstvwxz2456789';
const HASH = 'bcdfghjklmnpqrstvwxz2456789';

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const chars = (rand, alphabet, length) => Array.from({ length }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
const hex = (rand, length) => Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');
const uid = (rand) => `${hex(rand, 8)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 12)}`;

/** A sample from a list of [value, weight] pairs. */
function weighted(rand, pairs) {
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  let at = rand() * total;
  for (const [value, weight] of pairs) {
    at -= weight;
    if (at < 0) {
      return value;
    }
  }

  return pairs.at(-1)[0];
}

function stems(rand, count) {
  const seen = new Set();
  while (seen.size < count) {
    const parts = [pick(rand, WORDS)];
    if (rand() < 0.7) {
      parts.push(pick(rand, WORDS));
    }

    if (rand() < 0.35) {
      parts.push(pick(rand, QUALIFIERS));
    }

    if (rand() < 0.08) {
      parts.unshift(pick(rand, NAMESPACE_STEMS));
    }

    seen.add(parts.join('-').slice(0, 44));
  }

  return [...seen];
}

function namespaces(rand, count) {
  const seen = new Set(NAMESPACE_STEMS);
  while (seen.size < count) {
    seen.add(`${pick(rand, ['team', 'app', 'svc', 'env'])}-${pick(rand, WORDS)}${rand() < 0.4 ? `-${pick(rand, ['prod', 'stage', 'dev', 'canary'])}` : ''}`.slice(0, 36));
  }

  return [...seen];
}

/** `restarts` with a heavy tail: most Pods none, a few a handful, a crash loop thousands. */
function restartsOf(rand, word) {
  const crashing = word === 'CrashLoopBackOff' || word === 'Error';
  const roll = rand();
  if (crashing) {
    return roll < 0.3 ? Math.floor(5 + rand() * 40) : roll < 0.9 ? Math.floor(50 + rand() * 950) : Math.floor(1000 + rand() * 9000);
  }

  return roll < 0.88 ? 0 : roll < 0.97 ? Math.floor(1 + rand() * 9) : roll < 0.998 ? Math.floor(10 + rand() * 90) : Math.floor(100 + rand() * 900);
}

/**
 * @param {number} count How many rows.
 * @param {{ seed?: number, now?: number }} [options] `now` fixes the clock the ages are drawn against.
 */
export function longTailRows(count, { seed = 7, now = Date.parse('2026-11-16T00:00:00Z') } = {}) {
  const rand = rng(seed);
  const nsList = namespaces(rand, 40);
  // A long tail: the k-th namespace holds 1/(k+1) of what the first holds.
  const nsWeights = nsList.map((value, index) => [value, 1 / (index + 1)]);
  const stemList = stems(rand, 420);
  const stemWeights = stemList.map((value, index) => [value, 1 / (index + 8)]);
  const nodes = Array.from({ length: 64 }, (_, index) => (index % 3 === 0
    ? `gke-prod-pool-${1 + (index % 4)}-${hex(rand, 8)}-${chars(rand, SUFFIX, 4)}`
    : `ip-10-${Math.floor(rand() * 4)}-${Math.floor(rand() * 255)}-${Math.floor(rand() * 255)}.us-west-2.compute.internal`));
  const statuses = [['Running', 905], ['Completed', 30], ['Pending', 25], ['CrashLoopBackOff', 15], ['Error', 8], ['ImagePullBackOff', 7], ['ContainerCreating', 6], ['Terminating', 4], ['Init:0/2', 3], ['Init:1/3', 2], ['Unknown', 1]];
  const containerCounts = [[1, 70], [2, 20], [3, 7], [4, 3]];

  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const stem = weighted(rand, stemWeights);
    const kind = weighted(rand, [['deployment', 70], ['statefulset', 8], ['daemonset', 12], ['cronjob', 10]]);
    const name = kind === 'deployment'
      ? `${stem}-${chars(rand, HASH, 10)}-${chars(rand, SUFFIX, 5)}`
      : kind === 'statefulset'
        ? `${stem}-${Math.floor(rand() * 12)}`
        : kind === 'daemonset'
          ? `${stem}-${chars(rand, SUFFIX, 5)}`
          : `${stem}-${Math.floor(28_000_000 + rand() * 900_000)}-${chars(rand, SUFFIX, 5)}`;
    const word = weighted(rand, statuses);
    const total = weighted(rand, containerCounts);
    const ready = word === 'Running' ? total : word === 'Completed' ? 0 : Math.floor(rand() * total);
    const scheduled = !(word === 'Pending' && rand() < 0.5) && word !== 'Unknown';
    // Ages: log-uniform from 5 seconds to 420 days.
    const ageMs = Math.exp(Math.log(5_000) + rand() * (Math.log(420 * 86_400_000) - Math.log(5_000)));
    rows.push({
      key: uid(rand),
      name: name.slice(0, 63),
      namespace: weighted(rand, nsWeights),
      nameTail: nameTail(name.slice(0, 63)),
      ready: { ready, total },
      status: { word, role: stateRole(word) },
      restarts: scheduled ? restartsOf(rand, word) : undefined,
      createdAt: Math.round(now - ageMs),
      node: scheduled ? pick(rand, nodes) : undefined,
      ip: scheduled ? `10.${Math.floor(rand() * 4)}.${Math.floor(rand() * 255)}.${Math.floor(rand() * 255)}` : undefined,
    });
  }

  return rows;
}
