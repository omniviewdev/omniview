// The detail pages' side of the Pods cluster check: what `kubectl get pod -o json` says a Pod's detail page must print, what `kubectl get deployment -o json` says the generic detail page of a Deployment
// must print (K2c-2), and how a reading of a page differs from it. Pure functions only (no process, no browser), so `detail.test.mjs` proves each failure mode without a cluster. The browser part is
// `checkDetail` and `checkDeploymentDetail` in parity.mjs.

// The Pod whose detail the check opens: a StatefulSet's, so its name is exact and its values do not change while the check runs.
export const DETAIL_POD = { namespace: 'checkout', name: 'cart-cache-0' };

// The route of a Pod's detail page, as the Pods list's name link carries it (the plugin's contribution `kubernetes/pod`).
export const detailHref = ({ namespace, name }) => `#/kubernetes/pod?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`;

// `kubectl get pod <name> -n <namespace> -o json` (parsed) -> the plain-text values the page's header and Details section print.
export function expectedDetail(pod) {
  const ips = (pod.status?.podIPs ?? []).map((entry) => entry.ip);
  if (ips.length === 0 && pod.status?.podIP) ips.push(pod.status.podIP);
  return {
    name: pod.metadata?.name,
    node: pod.spec?.nodeName,
    podIP: ips.join(', '),
    hostIP: pod.status?.hostIP,
    qos: pod.status?.qosClass,
  };
}

// What the page prints, by the label of its Details rows (`Pod IP` or `Pod IPs`: the plugin's wording).
// `read` is `{ h1, kv }`: the header's title and the Details section's [label, value] rows.
const checker = (problems) => (field, page, oracle) => {
  if (oracle === undefined || oracle === '') {
    problems.push(`${field}: kubectl has no value, so the check cannot compare it`);
  } else if (page !== oracle) {
    problems.push(`${field}: the page says ${JSON.stringify(page ?? null)}, kubectl says ${JSON.stringify(oracle)}`);
  }
};

export function compareDetail(read, expected) {
  const rows = new Map((read.kv ?? []).map(([label, value]) => [label, value]));
  const problems = [];
  const check = checker(problems);
  check('name', read.h1, expected.name);
  check('Node', rows.get('Node'), expected.node);
  check('Pod IP', rows.get('Pod IP') ?? rows.get('Pod IPs'), expected.podIP);
  check('Host IP', rows.get('Host IP'), expected.hostIP);
  check('QoS class', rows.get('QoS class'), expected.qos);
  return problems;
}

// The Deployment whose generic detail page the check opens (K2c-2): the fixture's `cart-api`, which the check never changes, so its rows do not move while it runs.
export const DETAIL_DEPLOYMENT = { namespace: 'checkout', name: 'cart-api' };

// The route of a Deployment's detail page, as the Deployments list's name link carries it (the plugin's contribution `kubernetes/deployment`).
export const deploymentHref = ({ namespace, name }) => `#/kubernetes/deployment?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`;

// `kubectl get deployment <name> -n <namespace> -o json` (parsed) -> the values the page's header and Details rows print, in the page's words: the strategy as `Rolling update · max surge 25%, max
// unavailable 25%` (`Recreate` alone), the revision the controller wrote on the object, and the history limit with its noun.
export function expectedDeployment(deployment) {
  const strategy = deployment.spec?.strategy;
  const limit = deployment.spec?.revisionHistoryLimit;
  let strategyText;
  if (strategy?.type === 'RollingUpdate') {
    const { maxSurge, maxUnavailable } = strategy.rollingUpdate ?? {};
    const limits = [maxSurge === undefined ? undefined : `max surge ${String(maxSurge)}`, maxUnavailable === undefined ? undefined : `max unavailable ${String(maxUnavailable)}`].filter((part) => part !== undefined);
    strategyText = `Rolling update${limits.length === 0 ? '' : ` · ${limits.join(', ')}`}`;
  } else if (strategy?.type !== undefined) {
    strategyText = strategy.type;
  }

  return {
    name: deployment.metadata?.name,
    strategy: strategyText,
    revision: deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'],
    history: typeof limit === 'number' ? `${limit.toLocaleString('en-US')} revision${limit === 1 ? '' : 's'}` : undefined,
  };
}

// What the page prints, by the label of its Details rows. `read` is `{ h1, kv }`, as `compareDetail` takes it.
export function compareDeployment(read, expected) {
  const rows = new Map((read.kv ?? []).map(([label, value]) => [label, value]));
  const problems = [];
  const check = checker(problems);
  check('name', read.h1, expected.name);
  check('Strategy', rows.get('Strategy'), expected.strategy);
  check('Revision', rows.get('Revision'), expected.revision);
  check('Revision history', rows.get('Revision history'), expected.history);
  return problems;
}
