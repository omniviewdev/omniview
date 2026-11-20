// The sidebar's counts of the Kubernetes plugin (Q2), against kubectl: what a sidebar row's name says, and what the cluster says it must. Pure: no browser, no cluster, so every rule is a unit test and the controls
// (counts.test.mjs) can try to fool it. The page reads the rows (parity.mjs `checkCounts`), kubectl is read before and after, and this compares.
//
// What the host draws in a row (ui-next/shell/Tree.tsx; docs/ui-next/status/Q2a.md): the row is named by its content, the label and then the count: `Pods 50` (an exact count, grouped digits: `Pods 1,234`),
// `Deployments about 11` (an estimate, drawn `~11`), and just `Secrets` when there is no count to say (loading, unknown, a kind the user may not list).
//
// What the plugin may say (the backend's count, Q1): a read of one object ends in the page when the kind has none or one (exact), and above that is the API server's own estimate; the kind whose list is open
// is the list's own live count, exact. So a count is right when it names kubectl's number, and exact where it must be.

const NUMBER = /^\d{1,3}(?:,\d{3})*$|^\d+$/;

/** What a row's name says: its label and its count, `exact`, an `estimate` (the name says "about"), or `none`. */
export function parseRowName(name) {
  const text = String(name).trim();
  const estimate = /^(.*\S) about (\S+)$/.exec(text);
  if (estimate !== null && NUMBER.test(estimate[2])) {
    return { label: estimate[1], precision: 'estimate', value: Number(estimate[2].replaceAll(',', '')) };
  }

  const exact = /^(.*\S) (\S+)$/.exec(text);
  if (exact !== null && NUMBER.test(exact[2])) {
    return { label: exact[1], precision: 'exact', value: Number(exact[2].replaceAll(',', '')) };
  }

  return { label: text, precision: 'none' };
}

/** How many objects `kubectl get <kind> [-A] --no-headers` printed: its non-blank lines. */
export function countLines(output) {
  return String(output).split('\n').filter((line) => line.trim() !== '').length;
}

/**
 * Whether a count of `expected` objects must be exact: a kind that has none or one ends the read in a page of one, and the kind whose list is open is the list's own count. Above that a count is exact when a live
 * source of the kind is held and an estimate when it is not, and which of the two a kind has depends on what the plugin held a moment ago, so both are right when the number is.
 */
export const mustBeExact = (expected, isOpen) => isOpen || expected <= 1;

/**
 * The problems of the sidebar's rows against what the cluster holds. `rows` are the names of the sidebar's rows, `expected` is `{ <label>: <number kubectl counted> }`, and `open` is the label of the kind whose list is
 * open (its count is the list's own, live and exact). A kind that has objects and shows no count, a wrong number and an estimate where the count must be exact are problems;
 * a row that is not there is one too. Whether a number is exact or an estimate is held to `mustBeExact` and no further.
 */
export function compareCounts({ rows, expected, open }) {
  const parsed = new Map(rows.map(parseRowName).map((row) => [row.label, row]));
  const problems = [];
  for (const [label, number] of Object.entries(expected)) {
    const row = parsed.get(label);
    if (row === undefined) {
      problems.push(`${label}: no such row in the sidebar`);
    } else if (row.precision === 'none') {
      problems.push(`${label}: the row has no count, kubectl lists ${String(number)}`);
    } else if (row.value !== number) {
      problems.push(`${label}: the row says ${String(row.value)}, kubectl lists ${String(number)}`);
    } else if (row.precision !== 'exact' && mustBeExact(number, label === open)) {
      problems.push(`${label}: the count is ${row.precision} where ${String(number)} objects are known exactly${label === open ? ' (the list is open)' : ''}`);
    }
  }

  return problems;
}
