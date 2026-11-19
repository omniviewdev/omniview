// The Pod detail page's side of the Pods cluster check: what `kubectl get pod -o json` says a Pod's detail page must print, and how a reading of the page differs from it.
// Pure functions only (no process, no browser), so `detail.test.mjs` proves each failure mode without a cluster. The browser part is `checkDetail` in parity.mjs.

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
export function compareDetail(read, expected) {
  const rows = new Map((read.kv ?? []).map(([label, value]) => [label, value]));
  const problems = [];
  const check = (field, page, oracle) => {
    if (oracle === undefined || oracle === '') {
      problems.push(`${field}: kubectl has no value, so the check cannot compare it`);
    } else if (page !== oracle) {
      problems.push(`${field}: the page says ${JSON.stringify(page ?? null)}, kubectl says ${JSON.stringify(oracle)}`);
    }
  };
  check('name', read.h1, expected.name);
  check('Node', rows.get('Node'), expected.node);
  check('Pod IP', rows.get('Pod IP') ?? rows.get('Pod IPs'), expected.podIP);
  check('Host IP', rows.get('Host IP'), expected.hostIP);
  check('QoS class', rows.get('QoS class'), expected.qos);
  return problems;
}
