// The oracle side of the sort check (K3a): the order the list's rows must stand in after a press on a column header, from what `kubectl get <kind> -A -o json` says. Pure functions only (no process, no
// browser); `parity.mjs` (`checkSort`) reads the page and the cluster and calls them.
//
// The rule is the mock's (k8s-resources.js:384-421), as the plugin's keys carry it (plugin `ui/src/kinds/sortKey.ts`): a number as a number, a time as its instant (ascending is the OLDEST first), a missing
// value LAST in either direction, and a tie in the pressed column in the list's default order, name ascending, in either direction (a stable sort: the direction turns the keys round, not the ties).
// The page says which direction a press gave (`aria-sort`); the direction is read, never assumed, and the second press must say the other one.

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// What the plugin's Restarts cell says (`podRestarts`, plugin `ui/src/kinds/pods/fields.ts`): the sum of the regular containers' restart counts; no value when no status was reported or any count is missing.
export function podRestarts(pod) {
  const statuses = pod?.status?.containerStatuses;
  if (!Array.isArray(statuses) || statuses.some((status) => typeof status?.restartCount !== 'number')) {
    return undefined;
  }

  return statuses.reduce((sum, status) => sum + status.restartCount, 0);
}

// `kubectl get pods -A -o json` -> one item per Pod: `namespace/name`, name and the Restarts key.
export function podsByRestarts(list) {
  return list.items.map((pod) => ({ id: `${pod.metadata.namespace}/${pod.metadata.name}`, name: pod.metadata.name, key: podRestarts(pod) }));
}

// `kubectl get deployments -A -o json` -> one item per Deployment: `namespace/name`, name and the Age key, the creation instant (a timestamp has a resolution of one second, so ties are common).
export function deploymentsByAge(list) {
  return list.items.map((item) => {
    const created = Date.parse(item.metadata.creationTimestamp ?? '');
    return { id: `${item.metadata.namespace}/${item.metadata.name}`, name: item.metadata.name, key: Number.isNaN(created) ? undefined : created };
  });
}

// The ids in the order the rule gives for `direction` ('ascending' | 'descending').
export function expectedOrder(items, direction) {
  if (direction !== 'ascending' && direction !== 'descending') {
    throw new Error(`a sort direction is ascending or descending, not ${JSON.stringify(direction)}`);
  }

  const sign = direction === 'descending' ? -1 : 1;
  return [...items]
    .sort((a, b) => {
      if (a.key === undefined || b.key === undefined) {
        return a.key === b.key ? collator.compare(a.name, b.name) : a.key === undefined ? 1 : -1;
      }

      return (a.key - b.key) * sign || collator.compare(a.name, b.name);
    })
    .map((item) => item.id);
}

// The direction `aria-sort` says, or undefined when the column is not the sort in force (`none`, no attribute).
export function directionOf(ariaSort) {
  return ariaSort === 'ascending' || ariaSort === 'descending' ? ariaSort : undefined;
}

export const opposite = (direction) => (direction === 'ascending' ? 'descending' : 'ascending');

// Where the rows on screen differ from the order the rule gives. Empty when they are the same list in the same order.
export function compareOrder(shown, expected) {
  const missing = expected.filter((id) => !shown.includes(id));
  const extra = shown.filter((id) => !expected.includes(id));
  if (missing.length > 0 || extra.length > 0 || new Set(shown).size !== shown.length) {
    return [`the rows on screen are not the cluster's objects (${String(shown.length)} shown, ${String(expected.length)} in the cluster; only in the cluster: ${missing.slice(0, 3).join(', ') || 'none'}; only on screen: ${extra.slice(0, 3).join(', ') || 'none'})`];
  }

  const at = shown.findIndex((id, index) => id !== expected[index]);
  return at === -1 ? [] : [`the rows are out of order at row ${String(at + 1)}: the page has ${shown[at]}, the cluster's order has ${expected[at]}`];
}

// What a reading of the page must say after a press, against the cluster read before and after it: the column says a direction (`wanted`, when the press must give one), the rows are in that direction's order.
// A cluster that changed between its two reads gives no order to compare against, and that is reported, not compared.
export function compareSorted({ ariaSort, ids, before, after, wanted }) {
  const direction = directionOf(ariaSort);
  if (direction === undefined) {
    return [`the column's aria-sort says ${JSON.stringify(ariaSort ?? null)}: the press sorted nothing`];
  }

  if (wanted !== undefined && direction !== wanted) {
    return [`the column says ${direction}, the press must have turned it to ${wanted}`];
  }

  const expected = expectedOrder(before, direction);
  if (JSON.stringify(expected) !== JSON.stringify(expectedOrder(after, direction))) {
    return ['the cluster changed while the page was read'];
  }

  return compareOrder(ids, expected);
}

// A press can only be told from no press when the two directions put the rows in different orders: at least two distinct keys, one of them present.
export function sortCanBeTold(items) {
  return JSON.stringify(expectedOrder(items, 'ascending')) !== JSON.stringify(expectedOrder(items, 'descending'));
}
