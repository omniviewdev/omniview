// The Overview's side of the Pods cluster check (HM3c, plugin PR #287): the page a connection lands on is the cluster Overview, and it must say what kubectl alone says of the cluster. This file reads a snapshot of the
// page's DOM into a model, makes the expected model from kubectl's output, compares the two, and holds the rules of the page while it loads. Pure functions only (no process, no browser), so `overview.test.mjs` proves each
// failure mode without a cluster. The browser part is `checkOverview` and `readOverviewDom` in parity.mjs; kubectl is read there too.
//
// What the page is (the plugin's `ui/src/overview/`: model.ts, view.tsx, cells.tsx, assess.ts, facts.ts; the host's `ui-next/page/DetailPage.tsx` draws it): one tab, titled Overview; one h1, the connection's NAME; the sidebar's
// Overview entry current; a summary line (`Needs attention · 4 failing`, `Everything is running`, `Checking · Not checked in full yet: Pods, Jobs`); and up to three sections, in this order:
//   attention  (`data-detail-section=attention`, only when something fails) a count beside the title, then one row for each group of failing objects of one kind that share a word: `3 Pods in CrashLoopBackOff` over the first
//              two names and `and 1 more` (one object: its name, its namespace and what more is known of it, `crashloop · checkout · 1 restart`)
//   workloads  a table of the kinds Pods, Deployments, StatefulSets, DaemonSets, Jobs and CronJobs: Status (`Needs attention`, `Healthy`, `Loading`), Total, Failing (`None failing`, `3`, `3+`, `Not checked`, a dash)
//   cluster    Kubernetes version, Nodes (`1 · 1 ready`), Namespaces, API server (the address without credentials or query)
// The expected page is made from kubectl and the kubeconfig and from no rule of the plugin: each kind fails by a rule written here, in the simple form (a Job whose Failed condition is True, a workload with fewer ready than wanted,
// a Node whose Ready is not True, a Pod by kubectl's own STATUS word), so the two agree only when the plugin's rules do.
import { DERIVED_ID } from './lane.mjs';

export const OVERVIEW_TAB = 'Overview';

/** The kinds of the Workloads table, in its order. */
export const WORKLOAD_KINDS = ['Pods', 'Deployments', 'StatefulSets', 'DaemonSets', 'Jobs', 'CronJobs'];

/** The rows of the Cluster section, in its order. */
export const CLUSTER_LABELS = ['Kubernetes version', 'Nodes', 'Namespaces', 'API server'];

// The kinds Needs attention can speak of: the table's six (CronJobs have no rule, so they never fail), the claims and the Nodes. `one` is the word of a row of one object (`1 Job failed`).
const KINDS = [
  { label: 'Pods', one: 'Pod', namespaced: true },
  { label: 'Deployments', one: 'Deployment', namespaced: true },
  { label: 'StatefulSets', one: 'StatefulSet', namespaced: true },
  { label: 'DaemonSets', one: 'DaemonSet', namespaced: true },
  { label: 'Jobs', one: 'Job', namespaced: true },
  { label: 'CronJobs', one: 'CronJob', namespaced: true },
  { label: 'PersistentVolumeClaims', one: 'PersistentVolumeClaim', namespaced: true },
  { label: 'Nodes', one: 'Node', namespaced: false },
];
const NOUNS = new Map(KINDS.flatMap((kind) => [[kind.label, kind], [kind.one, kind]]));
const KIND = new Map(KINDS.map((kind) => [kind.label, kind]));

/** The page groups digits as the platform does for English: `1,234`. */
const grouped = (value) => value.toLocaleString('en-US');
const numberOf = (digits) => Number(digits.replaceAll(',', ''));
const NUMBER = '(\\d{1,3}(?:,\\d{3})+|\\d+)';

// --- reading the page -------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A cell of the Workloads table as the page words it: `None failing`, a count (`25`, `1,234`), at least that many (`3+`), an estimate (`~11`), `Not checked`, the dash of a figure that is not known yet, and
 * `Not available` (a read that failed). Anything else is `other`, and is never taken for a number.
 */
export function readFigure(text) {
  if (text === 'None failing') return { text, kind: 'none' };
  if (text === 'Not checked') return { text, kind: 'notChecked' };
  if (text === 'Not available') return { text, kind: 'unavailable' };
  if (text === '—') return { text, kind: 'dash' };
  let found = new RegExp(`^${NUMBER}$`).exec(text);
  if (found !== null) return { text, kind: 'count', value: numberOf(found[1]) };
  found = new RegExp(`^${NUMBER}\\+$`).exec(text);
  if (found !== null) return { text, kind: 'atLeast', value: numberOf(found[1]) };
  found = new RegExp(`^~${NUMBER}$`).exec(text);
  if (found !== null) return { text, kind: 'estimate', value: numberOf(found[1]) };
  return { text, kind: 'other' };
}

// One row of Needs attention: `<count> <noun> <phrase>` over what it names. A row of one object names it, its namespace (a Node has none) and what more is known (`3 restarts`); a row of several names the first two and
// says how many more (`bad-image, crashloop and 1 more`). A row that is not about a kind (`Pods can't be listed`, `1 API group is unavailable`) has no kind.
function readAttentionRow([title, detail = '']) {
  const found = new RegExp(`^${NUMBER} (\\S+) (.+)$`).exec(title);
  const kind = found === null ? undefined : NOUNS.get(found[2]);
  if (found === null || kind === undefined) {
    return { title, detail, kind: null };
  }

  const count = numberOf(found[1]);
  const row = { title, detail, count, noun: found[2], kind: kind.label, phrase: found[3] };
  if (count === 1) {
    const [name, ...rest] = detail.split(' · ');
    const extra = kind.namespaced ? rest.slice(1) : rest;
    return { ...row, names: [name], ...(kind.namespaced && rest.length > 0 ? { namespace: rest[0] } : {}), ...(extra.length > 0 ? { extra } : {}), more: 0 };
  }

  const named = new RegExp(`^(.*?)(?: and ${NUMBER} more)?$`).exec(detail);
  return { ...row, names: named[1] === '' ? [] : named[1].split(', '), more: named[2] === undefined ? 0 : numberOf(named[2]) };
}

/** The summary line from the text of its items, in order: the page joins them with a dot. */
function readSummary(items) {
  if (items === null || items.length === 0) {
    return null;
  }

  const text = items.join(' · ');
  const failing = /^Needs attention · (\d[\d,]*) failing/.exec(text);
  return { text, checking: items[0] === 'Checking', everything: text === 'Everything is running', failing: failing === null ? undefined : numberOf(failing[1]) };
}

/**
 * A snapshot of the page (`readOverviewDom` of parity.mjs) as a model:
 *   tabs        the strip's tabs: `{ title, name, selected }`            headings  the texts of the page's headings of level 1      current  the sidebar's current entries, by name
 *   summary     `{ text, checking, everything, failing }`, null when the page draws no summary line
 *   attention   `{ count, rows }`, null when the page draws no such section; a row is `{ title, detail, kind, count, phrase, names, more, namespace?, extra? }`
 *   workloads   `[{ kind, status, total, failing }]` (the two figures through `readFigure`), null when the page draws no such section
 *   cluster     `[{ label, value, loading }]`, null when the page draws no such section                                           sections  the ids of the sections the page draws, in order
 * A page that draws no Overview (the landing of the plugin before it, a list of Pods) is a page with no sections, never an Overview with nothing in it.
 */
export function readOverview(dom) {
  const section = (id) => dom.sections.find((candidate) => candidate.id === id);
  const attention = section('attention');
  const workloads = section('workloads');
  const cluster = section('cluster');
  const count = attention === undefined ? null : new RegExp(`^${NUMBER}$`).exec(attention.meta);
  return {
    tabs: dom.tabs,
    headings: dom.headings,
    current: dom.current,
    summary: readSummary(dom.summary),
    attention: attention === undefined ? null : { count: count === null ? null : numberOf(count[1]), rows: attention.rows.map(readAttentionRow) },
    workloads: workloads === undefined ? null : workloads.rows.map(([kind, status, total, failing]) => ({ kind, status, total: readFigure(total), failing: readFigure(failing) })),
    cluster: cluster === undefined ? null : cluster.rows.map(([label, value]) => ({ label, value, loading: /\bLoading\b/.test(value) })),
    sections: dom.sections.map((candidate) => candidate.id),
  };
}

/** Whether the page has settled: it draws a summary line and the line has stopped saying it is checking. */
export function isSettled(read) {
  return read.summary !== null && !read.summary.checking;
}

/** Whether a row of the Workloads table or of the Cluster section still says Loading. */
export function hasLoadingRow(read) {
  return (read.workloads ?? []).some((entry) => entry.status === 'Loading') || (read.cluster ?? []).some((entry) => entry.loading);
}

// --- the expected page ------------------------------------------------------------------------------------------------------------------------------------------------

/** The server's version in three numbers, as the page says it (`v1.31.4-eks-aeac579` is `v1.31.4`); a version of another shape is said as it is. */
export function shortVersion(version) {
  return /^v?\d+\.\d+\.\d+/.exec(version)?.[0] ?? version;
}

/**
 * The address of the API server as the page says it: the kubeconfig's server without credentials, query and fragment (the plugin's `sanitizedMetadataEndpoint`), and nothing for an address that is not http or https.
 */
export function sanitizedServer(server) {
  let url;
  try {
    url = new URL(server);
  } catch {
    return undefined;
  }

  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.host === '') {
    return undefined;
  }

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
}

// The STATUS words of `kubectl get pods` of a Pod that is failing; the Init: forms are decided below. `Unknown` is the word of a Pod whose node stopped reporting. A word that is in no list stops the check:
// a guess would let the page and the oracle agree on a wrong count (oracle.mjs, `quickFilterOf`).
const FAILING_WORDS = [
  'Error', 'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'InvalidImageName', 'CreateContainerConfigError', 'CreateContainerError', 'OOMKilled', 'Failed', 'Evicted',
  'NotReady', 'RunContainerError', 'ContainerCannotRun', 'DeadlineExceeded', 'Unknown',
];
// A Pod that only stays Pending is not failing, and nor is one that finished or is on its way.
const WELL_WORDS = ['Completed', 'Succeeded', 'Pending', 'ContainerCreating', 'PodInitializing', 'Terminating'];

/** Whether a row of `kubectl get pods -A --no-headers` (`{ status, ready }`) is a Pod that fails: by its STATUS word, or Running with a container that is not ready. */
function podFails({ status, ready }) {
  if (FAILING_WORDS.includes(status)) {
    return true;
  }

  if (status === 'Running') {
    const [have, want] = ready.split('/').map(Number);
    return have < want;
  }

  if (WELL_WORDS.includes(status) || /^Init:\d+\/\d+$/.test(status)) {
    return false;
  }

  if (status.startsWith('Init:')) {
    // An init container that failed takes the word of what follows `Init:`, and one the table has no word for fails (oracle.mjs, `quickFilterOf`).
    return !WELL_WORDS.includes(status.slice('Init:'.length));
  }

  throw new Error(`cannot classify the STATUS word ${JSON.stringify(status)}: read what the page's status table says and add it here`);
}

const conditionIs = (object, type, status) => (object.status?.conditions ?? []).some((condition) => condition.type === type && condition.status === status);
const idOf = ({ metadata }) => (metadata.namespace === undefined || metadata.namespace === '' ? metadata.name : `${metadata.namespace}/${metadata.name}`);

/** How long a claim may be Pending before it fails: five minutes. */
const STUCK_AFTER_MS = 5 * 60_000;

// What makes an object of a kind fail, in the simple form: a Job whose Failed condition is True; a Deployment or a StatefulSet with fewer replicas ready than wanted (one when it says nothing); a DaemonSet with fewer ready
// than it wants on nodes; a Node whose Ready condition is not True (or is not there); a claim that is Lost or has been Pending too long.
const RULES = {
  Deployments: (object) => (object.status?.readyReplicas ?? 0) < (object.spec?.replicas ?? 1),
  StatefulSets: (object) => (object.status?.readyReplicas ?? 0) < (object.spec?.replicas ?? 1),
  DaemonSets: (object) => object.status?.desiredNumberScheduled !== undefined && (object.status.numberReady ?? 0) < object.status.desiredNumberScheduled,
  Jobs: (object) => conditionIs(object, 'Failed', 'True'),
  PersistentVolumeClaims: (object, now) => object.status?.phase === 'Lost' || (object.status?.phase === 'Pending' && now - Date.parse(object.metadata.creationTimestamp) > STUCK_AFTER_MS),
  Nodes: (object) => !conditionIs(object, 'Ready', 'True'),
};

/**
 * The page kubectl says. `pods` are the rows of `kubectl get pods -A --no-headers` (`parseKubectlTable`: `{ name: 'namespace/name', ready, status }`), `objects` the items of `kubectl get deployments,statefulsets,
 * daemonsets,jobs,cronjobs,persistentvolumeclaims -A -o json` and of `kubectl get nodes,namespaces -o json` together (each has its `kind`), `version` the server's `gitVersion` (`kubectl version -o json`), `server` the
 * kubeconfig's server for the context, and `now` the time in milliseconds. Returns
 *   totals        how many objects of each kind of the Workloads table there are
 *   failing        for each kind that can fail, the sorted ids (`namespace/name`, a Node's name) of the objects that fail
 *   failingCount   how many fail, in all (what the summary and the section's count say)
 *   summary        the summary line of a page that has settled
 *   cluster        the rows of the Cluster section, `[label, value]`
 */
export function expectedOverview({ pods, objects, version, server, now }) {
  const ofKind = (kind) => objects.filter((object) => object.kind === kind);
  const failing = Object.fromEntries(KINDS.map(({ label, one }) => [label, label === 'Pods' ? pods.filter(podFails).map((pod) => pod.name) : ofKind(one).filter((object) => RULES[label]?.(object, now) === true).map(idOf)]));
  for (const ids of Object.values(failing)) {
    ids.sort();
  }

  const nodes = ofKind('Node');
  const address = sanitizedServer(server);
  if (address === undefined) {
    throw new Error(`the kubeconfig's server ${JSON.stringify(server)} is not an http or https address: the check cannot say what the API server row must read`);
  }

  const total = Object.values(failing).reduce((sum, ids) => sum + ids.length, 0);
  return {
    totals: Object.fromEntries(WORKLOAD_KINDS.map((label) => [label, label === 'Pods' ? pods.length : ofKind(KIND.get(label).one).length])),
    failing,
    failingCount: total,
    summary: total > 0 ? `Needs attention · ${grouped(total)} failing` : 'Everything is running',
    cluster: [
      ['Kubernetes version', shortVersion(version)],
      ['Nodes', `${grouped(nodes.length)} · ${grouped(nodes.filter((node) => conditionIs(node, 'Ready', 'True')).length)} ready`],
      ['Namespaces', grouped(ofKind('Namespace').length)],
      ['API server', address],
    ],
  };
}

// --- the page against kubectl -----------------------------------------------------------------------------------------------------------------------------------------

// The window: one tab, titled Overview and on screen; one heading, the connection's NAME (`context`: what kubectl calls the current context) and never its ID; the sidebar's Overview entry, and no other, current.
function compareIdentity(read, { context, id }) {
  const problems = [];
  const { tabs, headings } = read;
  if (!(tabs.length === 1 && tabs[0].title === OVERVIEW_TAB && tabs[0].selected)) {
    problems.push(`tab: the window's tabs are [${tabs.map((tab) => `${JSON.stringify(tab.title)}${tab.selected ? ' on screen' : ''}`).join(', ')}], wanted one tab, titled ${JSON.stringify(OVERVIEW_TAB)}, on screen`);
  }

  const name = JSON.stringify(context);
  if (context === undefined || context === '') {
    problems.push('heading: kubectl has no current context, so the check cannot compare the heading');
  } else if (headings.length === 0) {
    problems.push(`heading: the page has no heading of level 1, wanted one: the connection's name ${name}`);
  } else if (headings.length > 1) {
    problems.push(`heading: the page has ${String(headings.length)} headings of level 1 (${headings.join(', ')}), wanted one: the connection's name ${name}`);
  } else if (headings[0] === id && id !== context) {
    problems.push(`heading: the page's heading is the connection's ID (${id}), where a person reads its name ${name}`);
  } else if (headings[0] !== context) {
    problems.push(`heading: the page's heading is ${JSON.stringify(headings[0])}, the connection's name is ${name} (the context kubectl calls current)${DERIVED_ID.test(headings[0]) ? '; the text is shaped like a derived ID (<slug>-<10 hex>)' : ''}`);
  }

  if (!(read.current.length === 1 && read.current[0] === OVERVIEW_TAB)) {
    problems.push(`sidebar: the current entries are ${JSON.stringify(read.current)}, wanted only ${JSON.stringify(OVERVIEW_TAB)}`);
  }

  return problems;
}

// Needs attention: its count is the number of objects that fail, the counts of its rows add up to it, and to the number of each kind; a row names no more than it counts and says how many more; every name a row shows is
// an object that fails (a row of one object names its namespace too); and where every row of a kind shows all its names, every object of that kind that fails is named by one. A row that is not about a kind is a
// problem: the cluster of the check has no read that fails and no API group that cannot answer.
function compareAttention(attention, expected) {
  const problems = [];
  if (attention.count !== expected.failingCount) {
    problems.push(`attention: the section says ${attention.count === null ? 'no count' : String(attention.count)} failing, kubectl lists ${String(expected.failingCount)}`);
  }

  for (const row of attention.rows.filter((candidate) => candidate.kind === null)) {
    problems.push(`attention: the row "${row.title}" is not about an object kubectl lists as failing`);
  }

  const rows = attention.rows.filter((candidate) => candidate.kind !== null);
  const counted = rows.reduce((sum, row) => sum + row.count, 0);
  if (counted !== expected.failingCount) {
    problems.push(`attention: the rows count ${String(counted)} objects, kubectl lists ${String(expected.failingCount)}`);
  }

  for (const row of rows) {
    if (row.names.length + row.more !== row.count) {
      problems.push(`attention: the row "${row.title}" counts ${String(row.count)} and names ${String(row.names.length)} and says ${String(row.more)} more`);
    }
  }

  for (const { label, one } of KINDS) {
    const failing = expected.failing[label];
    const ofKind = rows.filter((row) => row.kind === label);
    const sum = ofKind.reduce((total, row) => total + row.count, 0);
    if (sum !== failing.length) {
      problems.push(`attention: the rows count ${String(sum)} ${label}, kubectl lists ${String(failing.length)} failing`);
    }

    // The name of an object is the last part of its id; a row of one object also names its namespace, which is held too.
    const shown = (row, name) => (row.count === 1 && row.namespace !== undefined ? `${row.namespace}/${name}` : name);
    const fails = (row, name) => (row.count === 1 && row.namespace !== undefined ? failing.includes(shown(row, name)) : failing.some((id) => id.split('/').pop() === name));
    for (const row of ofKind) {
      for (const name of row.names.filter((candidate) => !fails(row, candidate))) {
        problems.push(`named: the row "${row.title}" names ${JSON.stringify(shown(row, name))}, which kubectl does not list as failing`);
      }
    }

    if (ofKind.every((row) => row.more === 0)) {
      for (const id of failing) {
        if (!ofKind.some((row) => row.names.some((name) => fails(row, name) && (shown(row, name) === id || id.split('/').pop() === name)))) {
          problems.push(`named: no row names the failing ${one} ${id}`);
        }
      }
    }
  }

  return problems;
}

// The Workloads table: the six kinds in its order; for each, the Total is the number kubectl lists, the Status is Needs attention when an object of the kind fails and Healthy when none does, and the Failing figure is
// their number or None failing.
function compareWorkloads(workloads, expected) {
  const problems = [];
  const kinds = workloads.map((entry) => entry.kind);
  if (JSON.stringify(kinds) !== JSON.stringify(WORKLOAD_KINDS)) {
    problems.push(`workloads: the table has the kinds ${kinds.join(', ')}, wanted ${WORKLOAD_KINDS.join(', ')}`);
  }

  for (const entry of workloads.filter((candidate) => WORKLOAD_KINDS.includes(candidate.kind))) {
    const { kind } = entry;
    const total = grouped(expected.totals[kind]);
    if (entry.total.text !== total) {
      problems.push(`total: ${kind}: the page says ${JSON.stringify(entry.total.text)}, kubectl lists ${total}`);
    }

    const failing = expected.failing[kind].length;
    const status = failing > 0 ? 'Needs attention' : 'Healthy';
    const figure = failing > 0 ? grouped(failing) : 'None failing';
    if (entry.status !== status) {
      problems.push(`status: ${kind}: the page says ${JSON.stringify(entry.status)}, wanted ${JSON.stringify(status)} (kubectl lists ${String(failing)} failing)`);
    }

    if (entry.failing.text !== figure) {
      problems.push(`failing: ${kind}: the page says ${JSON.stringify(entry.failing.text)}, wanted ${JSON.stringify(figure)} (kubectl lists ${String(failing)} failing)`);
    }
  }

  return problems;
}

// The Cluster section: each row says what kubectl and the kubeconfig say, whole: a fact that is not current says when it was read and is not the same text.
function compareCluster(cluster, expected) {
  const problems = [];
  for (const [label, value] of expected.cluster) {
    const entry = cluster.find((candidate) => candidate.label === label);
    if (entry === undefined) {
      problems.push(`cluster: no row ${JSON.stringify(label)}`);
    } else if (entry.value !== value) {
      problems.push(`cluster: ${label}: the page says ${JSON.stringify(entry.value)}, kubectl lists ${JSON.stringify(value)}`);
    }
  }

  return problems;
}

/**
 * The page against kubectl, once it has settled: the problems as readable lines, each starting with the rule that found it (tab, heading, sidebar, sections, summary, attention, named, workloads, total, status,
 * failing, cluster, and the two rules of a row of the page in any frame, loading and healthy); empty when the page says what kubectl says. A page that draws no Overview fails the rules that see it and is never skipped.
 *   read       `readOverview` of a snapshot                  expected   `expectedOverview`                  context, id   the connection's NAME (the context kubectl calls current) and the ID the host lists for it
 */
export function compareOverview(read, expected, { context, id } = {}) {
  const problems = compareIdentity(read, { context, id });
  const wanted = expected.failingCount > 0 ? ['attention', 'workloads', 'cluster'] : ['workloads', 'cluster'];
  if (JSON.stringify(read.sections) !== JSON.stringify(wanted)) {
    problems.push(`sections: the page draws ${read.sections.length === 0 ? 'no section' : read.sections.join(', ')}, wanted ${wanted.join(', ')}`);
  }

  if (read.summary === null) {
    problems.push(`summary: the page draws no summary line, wanted ${JSON.stringify(expected.summary)}`);
  } else if (read.summary.text !== expected.summary) {
    problems.push(`summary: the page says ${JSON.stringify(read.summary.text)}, wanted ${JSON.stringify(expected.summary)}`);
  }

  if (read.attention !== null) problems.push(...compareAttention(read.attention, expected));
  if (read.workloads !== null) problems.push(...compareWorkloads(read.workloads, expected));
  if (read.cluster !== null) problems.push(...compareCluster(read.cluster, expected));
  return [...problems, ...frameProblems(read)];
}

// --- the frames while it loads ----------------------------------------------------------------------------------------------------------------------------------------

/**
 * What the page may never say in any frame, from the press to the end: no fake zero. A row of the Workloads table that says Loading has read nothing whole, so its Failing figure is a dash or Not checked and never None failing
 * or a count; a row of the Cluster section that says Loading shows no number; the summary line does not say Everything is running while a row says Loading; and a row says Healthy only over None failing. Returns readable
 * lines, each starting with the rule (loading, healthy); empty when the frame breaks none.
 */
export function frameProblems(read) {
  const problems = [];
  for (const entry of read.workloads ?? []) {
    if (entry.status === 'Loading' && entry.failing.kind !== 'dash' && entry.failing.kind !== 'notChecked') {
      problems.push(`loading: ${entry.kind} says Loading and its Failing says ${JSON.stringify(entry.failing.text)}: a row that has not finished reads no zero`);
    }

    if (entry.status === 'Healthy' && entry.failing.kind !== 'none') {
      problems.push(`healthy: ${entry.kind} says Healthy over ${JSON.stringify(entry.failing.text)}: a Healthy row says None failing`);
    }
  }

  for (const entry of (read.cluster ?? []).filter((candidate) => candidate.loading && /\d/.test(candidate.value))) {
    problems.push(`loading: the Cluster row ${entry.label} says Loading and shows a number (${JSON.stringify(entry.value)})`);
  }

  if (read.summary?.everything === true) {
    const waiting = [...(read.workloads ?? []).filter((entry) => entry.status === 'Loading').map((entry) => entry.kind), ...(read.cluster ?? []).filter((entry) => entry.loading).map((entry) => entry.label)];
    if (waiting.length > 0) {
      problems.push(`loading: the summary says "Everything is running" while ${waiting.join(', ')} ${waiting.length === 1 ? 'says' : 'say'} Loading`);
    }
  }

  return problems;
}

/** How many of the frames the recorder kept show a row that is Loading: `frames` are `{ read, count }` (a reading and how many samples read exactly that); the distinct frames and the samples that read them. */
export function loadingFrames(frames) {
  const loading = frames.filter(({ read }) => hasLoadingRow(read));
  return { distinct: loading.length, samples: loading.reduce((total, { count }) => total + count, 0) };
}
