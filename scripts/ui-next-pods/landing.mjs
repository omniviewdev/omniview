// The plugin's landing in the Pods cluster check (KL3; plugin PR #289, on the host's seam of #772): the page a press on the plugin's row opens on a window that names no connection. Every page of the check is reached through it, and the
// check holds it to one fact of kubectl's. Pure functions only (no process, no browser), so `landing.test.mjs` proves each failure mode without a cluster. The browser part is `landingIsUp`, `openFromLanding` and `readLandingDom` in parity.mjs.
//
// What the page is (the plugin's `ui/src/landing/`: pages.ts, home.tsx, collection.tsx, parts.tsx; the host's `custom` page kind draws it, with no sidebar and no scope lane because it is read in no connection): a tab titled Kubernetes;
// one h1, the plugin's name; a section Connections whose table, a region of that name, has one row for each connection the host lists for the plugin. A row says the connection's name (a button: its press opens the connection, which the
// host starts first when it is not connected and then opens its Overview in a NEW tab, the landing staying where it is), its state in the host's word (`Disconnected`, `Connecting`, `Connected`, ...), the Kubernetes version of its server (`v1.35.0`;
// a dash while the connection is not connected, nothing while the read is on its way) and its region.

/** The title of the landing's tab. */
export const LANDING_TAB = 'Kubernetes';

/** The accessible name of the landing's table of connections, a region: it is what tells the landing from every other page the plugin's row can open. */
export const LANDING_TABLE = 'Connections';

/** The host's word for a connection that is connected. */
export const CONNECTED = 'Connected';

/**
 * A snapshot of the landing's table (`readLandingDom` of parity.mjs: `{ heads, rows: [{ name, cells }] }`, `null` when the page draws no such table) as the model the comparison reads: one entry for each connection, with its name, its state
 * and its Kubernetes version as the cells say them. A column the table does not have reads as `undefined`, which no rule takes for a good value.
 */
export function readLanding(dom) {
  if (dom === null) {
    return null;
  }

  const column = (head) => dom.heads.indexOf(head);
  return dom.rows.map((row) => ({ name: row.name, status: row.cells[column('Status')], version: row.cells[column('Kubernetes')] }));
}

/**
 * The first half of the assertion: the landing lists the connection of the context kubectl calls current, a row of its table with that name (the check opens it from there). What cannot be compared is a problem, never a pass.
 * Returns the problems as readable lines, each starting with the rule (listed); empty when the connection is listed.
 */
export function listedProblems(read, context) {
  const name = JSON.stringify(context);
  if (context === undefined || context === '') {
    return ['listed: kubectl has no current context, so the check cannot name the connection to open'];
  }

  if (read === null) {
    return [`listed: the page draws no table of connections (a region named ${JSON.stringify(LANDING_TABLE)}), wanted one that lists ${name}, the context kubectl calls current`];
  }

  if (!read.some((row) => row.name === context)) {
    return [`listed: the table lists ${read.length === 0 ? 'no connection' : read.map((row) => JSON.stringify(row.name)).join(', ')}, wanted one named ${name}, the context kubectl calls current`];
  }

  return [];
}

/**
 * The one assertion about the landing: it lists the connection of the context kubectl calls current and, once the check has opened that connection from it, shows it Connected with the Kubernetes version `kubectl version` reports for the server.
 *   read      `readLanding` of a snapshot, null when the page draws no table
 *   context   `kubectl config current-context`, the connection's NAME as the landing says it (a kubeconfig of one context has one connection)
 *   version   the server's version as the page says it (`v1.31.4-eks-aeac579` is `v1.31.4`: `shortVersion` of overview.mjs)
 * Returns the problems as readable lines, each starting with the rule that found it (listed, state, version); empty when the landing says what kubectl says.
 */
export function compareLanding(read, { context, version }) {
  const problems = listedProblems(read, context);
  if (problems.length > 0) {
    return problems;
  }

  const row = read.find((candidate) => candidate.name === context);
  const name = JSON.stringify(context);
  if (row.status !== CONNECTED) {
    problems.push(`state: the landing says ${name} is ${JSON.stringify(row.status)}, wanted ${JSON.stringify(CONNECTED)}: the press on it started the connection`);
  }

  if (version === undefined || version === '') {
    problems.push('version: kubectl says nothing of the server\'s version, so the check cannot compare the landing\'s');
  } else if (row.version !== version) {
    problems.push(`version: the landing says the Kubernetes version of ${name} is ${JSON.stringify(row.version)}, kubectl says the server is ${version}`);
  }

  return problems;
}
