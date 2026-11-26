import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKubectlTable } from './oracle.mjs';
import { CLUSTER_LABELS, compareOverview, expectedOverview, frameProblems, hasLoadingRow, isSettled, loadingFrames, OVERVIEW_TAB, readFigure, readOverview, sanitizedServer, shortVersion, WORKLOAD_KINDS } from './overview.mjs';

// The Overview the Kubernetes plugin opens a connection on (plugin PR #287), against what kubectl alone says (overview.mjs, with its controls): how a reading of the page's DOM becomes a model, how the expected model is made from
// kubectl's output, how the two are compared, and what the page may never say in a frame while it loads. Nothing here needs a cluster or a browser: the DOM readings below are what the page printed in a real
// run (WebKit and Chromium, kind v1.35.0 holding docs/ui-next/slices/1a-pods-list/fixture.yaml), and kubectl's side is that cluster's own output.

const NOW = Date.parse('2026-11-25T12:00:00Z');
const SERVER = 'https://127.0.0.1:55981';

// `kubectl get pods -A --no-headers` of the cluster: kind's nine Pods and the fixture's sixteen.
const PODS = parseKubectlTable(
  [
    'batch              broken-migration-2vv7t                       0/1   Error              0            4m',
    'batch              nightly-report-9mhvx                         0/1   Completed          0            4m',
    'batch              nightly-report-jqkbm                         0/1   Completed          0            4m',
    'batch              nightly-report-mg6vz                         0/1   Completed          0            4m',
    'checkout           bad-image                                    0/1   ErrImagePull       0            4m',
    'checkout           cart-api-86bf766589-k2psg                    2/2   Running            0            4m',
    'checkout           cart-api-86bf766589-pr77h                    2/2   Running            0            4m',
    'checkout           cart-api-86bf766589-qxxqk                    2/2   Running            0            4m',
    'checkout           cart-cache-0                                 1/1   Running            0            4m',
    'checkout           cart-cache-1                                 1/1   Running            0            4m',
    'checkout           crashloop                                    0/1   CrashLoopBackOff   1 (4s ago)   4m',
    'checkout           payment-gateway-6f45c7c7cd-cddg9             1/1   Running            0            4m',
    'checkout           payment-gateway-6f45c7c7cd-kf69s             1/1   Running            0            4m',
    'checkout           unschedulable                                0/1   Pending            0            4m',
    'kube-system        coredns-7d764666f9-8swh7                     1/1   Running            0            8m',
    'kube-system        coredns-7d764666f9-jxpmp                     1/1   Running            0            8m',
    'kube-system        etcd-hm3-pin-control-plane                   1/1   Running            0            8m',
    'kube-system        kindnet-sjnks                                1/1   Running            0            8m',
    'kube-system        kube-apiserver-hm3-pin-control-plane         1/1   Running            0            8m',
    'kube-system        kube-controller-manager-hm3-pin-control-plane 1/1  Running            0            8m',
    'kube-system        kube-proxy-9xq2k                             1/1   Running            0            8m',
    'kube-system        kube-scheduler-hm3-pin-control-plane         1/1   Running            0            8m',
    'local-path-storage local-path-provisioner-67b8995b4b-w5tqm      1/1   Running            0            8m',
    'monitoring         alertmanager-5d9c8f7b6c-7xq4z                1/1   Running            0            4m',
    'monitoring         node-agent-lq7sd                             1/1   Running            0            4m',
  ].join('\n'),
);

// `kubectl get deployments,statefulsets,daemonsets,jobs,cronjobs,persistentvolumeclaims -A -o json` and `kubectl get nodes,namespaces -o json`, the items of both: the API leaves out a count that is zero.
const deployment = (namespace, name, replicas, ready) => ({ kind: 'Deployment', metadata: { namespace, name }, spec: { replicas }, status: ready === 0 ? {} : { readyReplicas: ready } });
const statefulSet = (namespace, name, replicas, ready) => ({ kind: 'StatefulSet', metadata: { namespace, name }, spec: { replicas }, status: ready === 0 ? {} : { readyReplicas: ready } });
const daemonSet = (namespace, name, desired, ready) => ({ kind: 'DaemonSet', metadata: { namespace, name }, status: { desiredNumberScheduled: desired, numberReady: ready } });
const job = (namespace, name, conditions) => ({ kind: 'Job', metadata: { namespace, name }, status: { conditions } });
const claim = (namespace, name, phase, created) => ({ kind: 'PersistentVolumeClaim', metadata: { namespace, name, creationTimestamp: created }, status: { phase } });
const node = (name, conditions) => ({ kind: 'Node', metadata: { name }, status: { conditions } });
const namespaceOf = (name) => ({ kind: 'Namespace', metadata: { name } });
const FAILED = [
  { type: 'FailureTarget', status: 'True' },
  { type: 'Failed', status: 'True' },
];
const OBJECTS = [
  deployment('checkout', 'cart-api', 3, 3),
  deployment('checkout', 'payment-gateway', 2, 2),
  deployment('kube-system', 'coredns', 2, 2),
  deployment('local-path-storage', 'local-path-provisioner', 1, 1),
  deployment('monitoring', 'alertmanager', 1, 1),
  statefulSet('checkout', 'cart-cache', 2, 2),
  daemonSet('kube-system', 'kindnet', 1, 1),
  daemonSet('kube-system', 'kube-proxy', 1, 1),
  daemonSet('monitoring', 'node-agent', 1, 1),
  job('batch', 'broken-migration', FAILED),
  job('batch', 'nightly-report', [{ type: 'Complete', status: 'True' }]),
  node('hm3-pin-control-plane', [{ type: 'Ready', status: 'True' }]),
  ...['batch', 'checkout', 'default', 'kube-node-lease', 'kube-public', 'kube-system', 'local-path-storage', 'monitoring'].map(namespaceOf),
];
const oracle = (over = {}) => expectedOverview({ pods: PODS, objects: OBJECTS, version: 'v1.35.0', server: SERVER, now: NOW, ...over });

// What the page printed once it had settled (the in-page reading of parity.mjs: the tabs of the strip, the headings, the sidebar's current entries, the items of the summary line, each section as its rows of text).
const SETTLED = {
  // The plugin's landing, where the press on the connection was made and which stays, and the Overview that press opened in a new tab (a tab's name is its title, then the connection's name).
  tabs: [
    { title: 'Kubernetes', name: 'Kubernetes', selected: false },
    { title: 'Overview', name: 'Overview, kind-hm3-pin', selected: true },
  ],
  headings: ['kind-hm3-pin'],
  current: ['Overview'],
  summary: ['Needs attention', '4 failing'],
  sections: [
    {
      id: 'attention',
      title: 'Needs attention',
      meta: '4',
      kind: 'list',
      rows: [
        ['1 Pod in ErrImagePull', 'bad-image · checkout'],
        ['1 Pod with an error', 'broken-migration-2vv7t · batch'],
        ['1 Pod in CrashLoopBackOff', 'crashloop · checkout · 1 restart'],
        ['1 Job failed', 'broken-migration · batch'],
      ],
    },
    {
      id: 'workloads',
      title: 'Workloads',
      meta: '',
      kind: 'table',
      head: ['Kind', 'Status', 'Total', 'Failing'],
      rows: [
        ['Pods', 'Needs attention', '25', '3'],
        ['Deployments', 'Healthy', '5', 'None failing'],
        ['StatefulSets', 'Healthy', '1', 'None failing'],
        ['DaemonSets', 'Healthy', '3', 'None failing'],
        ['Jobs', 'Needs attention', '2', '1'],
        ['CronJobs', 'Healthy', '0', 'None failing'],
      ],
    },
    {
      id: 'cluster',
      title: 'Cluster',
      meta: '',
      kind: 'kv',
      rows: [
        ['Kubernetes version', 'v1.35.0'],
        ['Nodes', '1 · 1 ready'],
        ['Namespaces', '8'],
        ['API server', SERVER],
      ],
    },
  ],
};
const IDENTITY = { context: 'kind-hm3-pin', id: 'kind-hm3-pin-57a082bd74' };

/** A copy of a DOM reading, changed by `change`: a seeded fault never touches the reading the other tests share. */
function seeded(change, from = SETTLED) {
  const dom = structuredClone(from);
  change(dom);
  return dom;
}
const section = (dom, id) => dom.sections.find((candidate) => candidate.id === id);
const row = (dom, id, first) => section(dom, id).rows.find((cells) => cells[0] === first);
const problemsOf = (dom, expected = oracle(), identity = IDENTITY) => compareOverview(readOverview(dom), expected, identity);

test('the tab and the kinds are the ones the plugin\'s Overview has', () => {
  assert.equal(OVERVIEW_TAB, 'Overview');
  assert.deepEqual(WORKLOAD_KINDS, ['Pods', 'Deployments', 'StatefulSets', 'DaemonSets', 'Jobs', 'CronJobs']);
  assert.deepEqual(CLUSTER_LABELS, ['Kubernetes version', 'Nodes', 'Namespaces', 'API server']);
});

// --- reading the page -------------------------------------------------------------------------------------------------------------------------------------------------

test('readFigure reads a cell of the Workloads table as the page words it', () => {
  assert.deepEqual(readFigure('None failing'), { text: 'None failing', kind: 'none' });
  assert.deepEqual(readFigure('25'), { text: '25', kind: 'count', value: 25 });
  assert.deepEqual(readFigure('1,234'), { text: '1,234', kind: 'count', value: 1234 });
  assert.deepEqual(readFigure('3+'), { text: '3+', kind: 'atLeast', value: 3 });
  assert.deepEqual(readFigure('~11'), { text: '~11', kind: 'estimate', value: 11 });
  assert.deepEqual(readFigure('Not checked'), { text: 'Not checked', kind: 'notChecked' });
  assert.deepEqual(readFigure('—'), { text: '—', kind: 'dash' });
  assert.deepEqual(readFigure('Not available'), { text: 'Not available', kind: 'unavailable' });
  assert.deepEqual(readFigure('whatever'), { text: 'whatever', kind: 'other' });
});

test('readOverview reads a settled page: the tab, the one heading, the current entry, the summary, the three sections', () => {
  const read = readOverview(SETTLED);
  assert.deepEqual(read.tabs, SETTLED.tabs);
  assert.deepEqual(read.headings, ['kind-hm3-pin']);
  assert.deepEqual(read.current, ['Overview']);
  assert.deepEqual(read.sections, ['attention', 'workloads', 'cluster']);
  assert.deepEqual(read.summary, { text: 'Needs attention · 4 failing', checking: false, everything: false, failing: 4 });
  assert.deepEqual(read.workloads.map((entry) => [entry.kind, entry.status, entry.total.text, entry.failing.kind]), [
    ['Pods', 'Needs attention', '25', 'count'],
    ['Deployments', 'Healthy', '5', 'none'],
    ['StatefulSets', 'Healthy', '1', 'none'],
    ['DaemonSets', 'Healthy', '3', 'none'],
    ['Jobs', 'Needs attention', '2', 'count'],
    ['CronJobs', 'Healthy', '0', 'none'],
  ]);
  assert.deepEqual(read.cluster, [
    { label: 'Kubernetes version', value: 'v1.35.0', loading: false },
    { label: 'Nodes', value: '1 · 1 ready', loading: false },
    { label: 'Namespaces', value: '8', loading: false },
    { label: 'API server', value: SERVER, loading: false },
  ]);
  assert.equal(hasLoadingRow(read), false);
  assert.equal(isSettled(read), true);
});

test('readOverview reads a row of Needs attention: its count, its kind, its phrase, and the names it shows', () => {
  const read = readOverview(SETTLED);
  assert.equal(read.attention.count, 4);
  assert.deepEqual(read.attention.rows[0], { title: '1 Pod in ErrImagePull', detail: 'bad-image · checkout', count: 1, noun: 'Pod', kind: 'Pods', phrase: 'in ErrImagePull', names: ['bad-image'], namespace: 'checkout', more: 0 });
  assert.deepEqual(read.attention.rows[2].extra, ['1 restart']);
  assert.deepEqual(read.attention.rows[3], { title: '1 Job failed', detail: 'broken-migration · batch', count: 1, noun: 'Job', kind: 'Jobs', phrase: 'failed', names: ['broken-migration'], namespace: 'batch', more: 0 });
  const several = readOverview(seeded((dom) => (section(dom, 'attention').rows = [['3 Pods in CrashLoopBackOff', 'bad-image, crashloop and 1 more'], ['2 Deployments partially ready', 'cart-api, payment-gateway'], ['1,234 Pods not ready', 'a, b and 1,232 more']])));
  assert.deepEqual(
    several.attention.rows.map(({ count, kind, phrase, names, more }) => ({ count, kind, phrase, names, more })),
    [
      { count: 3, kind: 'Pods', phrase: 'in CrashLoopBackOff', names: ['bad-image', 'crashloop'], more: 1 },
      { count: 2, kind: 'Deployments', phrase: 'partially ready', names: ['cart-api', 'payment-gateway'], more: 0 },
      { count: 1234, kind: 'Pods', phrase: 'not ready', names: ['a', 'b'], more: 1232 },
    ],
  );
});

test('readOverview reads a Node, which lives in no namespace, and keeps a row it cannot explain as a row of no kind', () => {
  const read = readOverview(seeded((dom) => (section(dom, 'attention').rows = [['1 Node not ready', 'kind-worker'], ["Pods can't be listed", 'forbidden'], ['1 API group is unavailable', 'metrics.example.com/v1beta1']])));
  assert.deepEqual(read.attention.rows[0].names, ['kind-worker']);
  assert.equal(read.attention.rows[0].namespace, undefined);
  assert.equal(read.attention.rows[0].kind, 'Nodes');
  assert.equal(read.attention.rows[1].kind, null);
  assert.equal(read.attention.rows[2].kind, null);
  // What follows a Node's name is what more is known of it, and never a namespace: a Node has none.
  const alone = readOverview(seeded((dom) => (section(dom, 'attention').rows = [['1 Node not ready', 'kind-worker · 3 conditions']]))).attention.rows[0];
  assert.equal(alone.namespace, undefined);
  assert.deepEqual(alone.extra, ['3 conditions']);
});

test('readOverview reads a page that draws no Overview as a page with no sections, never as an empty Overview', () => {
  const list = readOverview({ tabs: [{ title: 'Pods', name: 'Pods', selected: true }], headings: [], current: ['Pods'], summary: null, sections: [] });
  assert.equal(list.summary, null);
  assert.equal(list.attention, null);
  assert.equal(list.workloads, null);
  assert.equal(list.cluster, null);
  assert.deepEqual(list.sections, []);
  assert.equal(isSettled(list), false);
  assert.equal(hasLoadingRow(list), false);
});

// --- the expected page ------------------------------------------------------------------------------------------------------------------------------------------------

test('expectedOverview counts the kinds as kubectl lists them and names what fails: the fixture\'s Job and its three Pods', () => {
  const expected = oracle();
  assert.deepEqual(expected.totals, { Pods: 25, Deployments: 5, StatefulSets: 1, DaemonSets: 3, Jobs: 2, CronJobs: 0 });
  assert.deepEqual(expected.failing.Pods, ['batch/broken-migration-2vv7t', 'checkout/bad-image', 'checkout/crashloop']);
  assert.deepEqual(expected.failing.Jobs, ['batch/broken-migration']);
  for (const kind of ['Deployments', 'StatefulSets', 'DaemonSets', 'CronJobs', 'PersistentVolumeClaims', 'Nodes']) {
    assert.deepEqual(expected.failing[kind], [], kind);
  }
  assert.equal(expected.failingCount, 4);
  assert.equal(expected.summary, 'Needs attention · 4 failing');
  assert.deepEqual(expected.cluster, [
    ['Kubernetes version', 'v1.35.0'],
    ['Nodes', '1 · 1 ready'],
    ['Namespaces', '8'],
    ['API server', SERVER],
  ]);
});

test('a cluster where nothing fails says Everything is running, and a thousand objects are grouped as the page groups them', () => {
  const quiet = oracle({ pods: PODS.filter((entry) => !['Error', 'ErrImagePull', 'CrashLoopBackOff'].includes(entry.status)), objects: OBJECTS.filter((entry) => entry.metadata.name !== 'broken-migration') });
  assert.equal(quiet.failingCount, 0);
  assert.equal(quiet.summary, 'Everything is running');
  const many = Array.from({ length: 1234 }, (_, index) => ({ name: `ns/pod-${String(index)}`, ready: '1/1', status: 'Running' }));
  assert.equal(oracle({ pods: many }).totals.Pods, 1234);
  const failing = Array.from({ length: 1234 }, (_, index) => ({ name: `ns/pod-${String(index)}`, ready: '0/1', status: 'Error' }));
  assert.equal(oracle({ pods: failing, objects: [] }).summary, 'Needs attention · 1,234 failing');
});

test('a Pod fails by kubectl\'s own STATUS word, and a Pod that runs with a container not ready; a Pod that only stays Pending, or finished, does not', () => {
  const pods = (status, ready = '1/1') => oracle({ pods: [{ name: 'a/p', ready, status }] }).failing.Pods;
  for (const word of ['Error', 'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'InvalidImageName', 'CreateContainerConfigError', 'CreateContainerError', 'OOMKilled', 'Failed', 'Evicted', 'NotReady', 'RunContainerError', 'ContainerCannotRun', 'DeadlineExceeded', 'Unknown']) {
    assert.deepEqual(pods(word, '0/1'), ['a/p'], word);
  }
  for (const word of ['Init:Error', 'Init:CrashLoopBackOff', 'Init:ErrImagePull', 'Init:OOMKilled']) {
    assert.deepEqual(pods(word, '0/1'), ['a/p'], word);
  }
  assert.deepEqual(pods('Running', '1/2'), ['a/p'], 'Running with one container of two ready');
  assert.deepEqual(pods('Running', '0/1'), ['a/p'], 'the crash-looping Pod in the second it runs again');
  for (const [word, ready] of [['Running', '2/2'], ['Pending', '0/1'], ['ContainerCreating', '0/1'], ['PodInitializing', '0/1'], ['Terminating', '1/1'], ['Completed', '0/1'], ['Succeeded', '0/1'], ['Init:0/1', '0/1'], ['Init:2/3', '0/1']]) {
    assert.deepEqual(pods(word, ready), [], word);
  }
});

test('a STATUS word the oracle cannot classify stops the check: a guessed answer would let the page and the oracle agree on a wrong count', () => {
  assert.throws(() => oracle({ pods: [{ name: 'a/p', ready: '1/1', status: 'SomethingNew' }] }), /cannot classify the STATUS word "SomethingNew"/);
});

test('a Job fails when its Failed condition is True; one that is failing to finish, or that completed, does not', () => {
  const jobs = (conditions) => oracle({ objects: [job('batch', 'j', conditions)] }).failing.Jobs;
  assert.deepEqual(jobs([{ type: 'Failed', status: 'True' }]), ['batch/j']);
  assert.deepEqual(jobs([{ type: 'Failed', status: 'False' }]), []);
  assert.deepEqual(jobs([{ type: 'FailureTarget', status: 'True' }]), []);
  assert.deepEqual(jobs([{ type: 'Complete', status: 'True' }]), []);
  assert.deepEqual(jobs(undefined), []);
});

test('a Deployment, a StatefulSet and a DaemonSet fail when fewer are ready than are wanted; a scale to zero, and every one ready, do not', () => {
  const failing = (objects) => oracle({ objects }).failing;
  assert.deepEqual(failing([deployment('a', 'd', 3, 2)]).Deployments, ['a/d']);
  assert.deepEqual(failing([deployment('a', 'd', 3, 0)]).Deployments, ['a/d']);
  assert.deepEqual(failing([deployment('a', 'd', 3, 3)]).Deployments, []);
  assert.deepEqual(failing([deployment('a', 'd', 0, 0)]).Deployments, []);
  assert.deepEqual(failing([{ kind: 'Deployment', metadata: { namespace: 'a', name: 'd' }, spec: {}, status: {} }]).Deployments, ['a/d'], 'a Deployment that sets no count wants one');
  assert.deepEqual(failing([statefulSet('a', 's', 2, 1)]).StatefulSets, ['a/s']);
  assert.deepEqual(failing([statefulSet('a', 's', 2, 2)]).StatefulSets, []);
  assert.deepEqual(failing([daemonSet('a', 'n', 3, 2)]).DaemonSets, ['a/n']);
  assert.deepEqual(failing([daemonSet('a', 'n', 3, 3)]).DaemonSets, []);
  assert.deepEqual(failing([{ kind: 'DaemonSet', metadata: { namespace: 'a', name: 'n' }, status: {} }]).DaemonSets, [], 'a DaemonSet with no counts says nothing, and nothing is failing');
});

test('a Node fails unless its Ready condition is True: False, Unknown and a missing condition all fail', () => {
  const nodes = (conditions) => oracle({ objects: [node('n1', conditions)] });
  assert.deepEqual(nodes([{ type: 'Ready', status: 'True' }]).failing.Nodes, []);
  assert.deepEqual(nodes([{ type: 'Ready', status: 'False' }]).failing.Nodes, ['n1']);
  assert.deepEqual(nodes([{ type: 'Ready', status: 'Unknown' }]).failing.Nodes, ['n1']);
  assert.deepEqual(nodes([{ type: 'MemoryPressure', status: 'False' }]).failing.Nodes, ['n1']);
  assert.deepEqual(nodes(undefined).failing.Nodes, ['n1']);
  const mixed = oracle({ objects: [node('n1', [{ type: 'Ready', status: 'True' }]), node('n2', [{ type: 'Ready', status: 'False' }]), node('n3', [{ type: 'Ready', status: 'True' }])] });
  assert.deepEqual(mixed.cluster[1], ['Nodes', '3 · 2 ready']);
});

test('a claim fails when it is Lost, or Pending for more than five minutes', () => {
  const claims = (phase, created) => oracle({ objects: [claim('a', 'c', phase, created)] }).failing.PersistentVolumeClaims;
  assert.deepEqual(claims('Lost', '2026-11-25T11:59:00Z'), ['a/c']);
  assert.deepEqual(claims('Pending', '2026-11-25T11:50:00Z'), ['a/c']);
  assert.deepEqual(claims('Pending', '2026-11-25T11:57:00Z'), []);
  assert.deepEqual(claims('Bound', '2026-11-25T11:00:00Z'), []);
});

test('the Cluster rows say the server\'s version in three numbers, the nodes that are ready of those there are, the namespaces and the server\'s address without what a person must not read in it', () => {
  assert.equal(shortVersion('v1.35.0'), 'v1.35.0');
  assert.equal(shortVersion('v1.31.4-eks-aeac579'), 'v1.31.4');
  assert.equal(shortVersion('1.30.2+k3s1'), '1.30.2');
  assert.equal(shortVersion('main'), 'main');
  assert.equal(sanitizedServer('https://127.0.0.1:55981'), 'https://127.0.0.1:55981');
  assert.equal(sanitizedServer('https://127.0.0.1:55981/'), 'https://127.0.0.1:55981');
  assert.equal(sanitizedServer('https://user:secret@api.example.com:6443/k8s/clusters/c-1?token=abc#frag'), 'https://api.example.com:6443/k8s/clusters/c-1');
  assert.equal(sanitizedServer('ftp://api.example.com'), undefined);
  assert.equal(sanitizedServer(''), undefined);
  assert.equal(oracle({ version: 'v1.31.4-eks-aeac579' }).cluster[0][1], 'v1.31.4');
});

// --- the page against kubectl -----------------------------------------------------------------------------------------------------------------------------------------

test('a page that says what kubectl says agrees', () => {
  assert.deepEqual(problemsOf(SETTLED), []);
});

test('a cluster where nothing fails has no Needs attention section and says Everything is running', () => {
  const quiet = oracle({ pods: PODS.filter((entry) => !['Error', 'ErrImagePull', 'CrashLoopBackOff'].includes(entry.status)), objects: OBJECTS.filter((entry) => entry.metadata.name !== 'broken-migration') });
  const dom = seeded((value) => {
    value.summary = ['Everything is running'];
    value.sections = value.sections.filter((entry) => entry.id !== 'attention');
    row(value, 'workloads', 'Pods').splice(1, 3, 'Healthy', '22', 'None failing');
    row(value, 'workloads', 'Jobs').splice(1, 3, 'Healthy', '1', 'None failing');
  });
  assert.deepEqual(problemsOf(dom, quiet), []);
});

// Each control below is one fault seeded into a page that otherwise agrees, and it must be caught by the rule it is named for (AGENTS 28; the mutants of status/HM3c.md remove each rule in turn).

test('control total: a Total that is not kubectl\'s count is reported by the total rule alone', () => {
  const problems = problemsOf(seeded((dom) => (row(dom, 'workloads', 'Pods')[2] = '24')));
  assert.deepEqual(problems, ['total: Pods: the page says "24", kubectl lists 25']);
});

test('control total: a Total that is an estimate, or a dash, where the whole set is known is reported', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'workloads', 'Deployments')[2] = '~5'))), ['total: Deployments: the page says "~5", kubectl lists 5']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'workloads', 'CronJobs')[2] = '—'))), ['total: CronJobs: the page says "—", kubectl lists 0']);
});

test('control named: a Needs attention that does not name a failing object, the Job, is reported by the named rule', () => {
  const problems = problemsOf(seeded((dom) => (section(dom, 'attention').rows = section(dom, 'attention').rows.filter(([title]) => !title.includes('Job')))));
  assert.match(problems.join('\n'), /^named: no row names the failing Job batch\/broken-migration$/m);
});

test('control named: a row that names an object that is not failing is reported by the named rule, and says which', () => {
  const problems = problemsOf(seeded((dom) => (section(dom, 'attention').rows[3] = ['1 Job failed', 'nightly-report · batch'])));
  assert.match(problems.join('\n'), /^named: the row "1 Job failed" names "batch\/nightly-report", which kubectl does not list as failing$/m);
  assert.match(problems.join('\n'), /^named: no row names the failing Job batch\/broken-migration$/m);
});

test('control named: names that are shown by a row of several are held to the failing set, by name', () => {
  const grouped = seeded((dom) => {
    section(dom, 'attention').rows = [['3 Pods in CrashLoopBackOff', 'bad-image, crashloop and 1 more'], ['1 Job failed', 'broken-migration · batch']];
  });
  assert.deepEqual(problemsOf(grouped), []);
  const wrong = seeded((dom) => {
    section(dom, 'attention').rows = [['3 Pods in CrashLoopBackOff', 'bad-image, cart-cache-0 and 1 more'], ['1 Job failed', 'broken-migration · batch']];
  });
  assert.match(problemsOf(wrong).join('\n'), /^named: the row "3 Pods in CrashLoopBackOff" names "cart-cache-0", which kubectl does not list as failing$/m);
});

test('control attention: a count that is not the number of objects kubectl lists as failing is reported, in the section and in its rows', () => {
  const section3 = problemsOf(seeded((dom) => (section(dom, 'attention').meta = '3')));
  assert.deepEqual(section3, ['attention: the section says 3 failing, kubectl lists 4']);
  const rows = problemsOf(seeded((dom) => (section(dom, 'attention').rows = [['1 Pod in ErrImagePull', 'bad-image · checkout'], ['1 Pod in CrashLoopBackOff', 'crashloop · checkout · 1 restart'], ['1 Job failed', 'broken-migration · batch']])));
  assert.match(rows.join('\n'), /^attention: the rows count 3 objects, kubectl lists 4$/m);
  assert.match(rows.join('\n'), /^attention: the rows count 2 Pods, kubectl lists 3 failing$/m);
});

test('control attention: a row that counts more than it names, with no "and N more" to say so, is reported', () => {
  const problems = problemsOf(seeded((dom) => (section(dom, 'attention').rows[0] = ['3 Pods in ErrImagePull', 'bad-image, crashloop'])));
  assert.match(problems.join('\n'), /^attention: the row "3 Pods in ErrImagePull" counts 3 and names 2 and says 0 more$/m);
});

test('control attention: a row the cluster does not explain, a read that failed or an API group, is reported and never skipped', () => {
  const problems = problemsOf(seeded((dom) => section(dom, 'attention').rows.push(["Secrets can't be listed", 'forbidden'])));
  assert.deepEqual(problems, ['attention: the row "Secrets can\'t be listed" is not about an object kubectl lists as failing']);
});

test('control failing: a Failing cell that says None failing where kubectl lists a failing object is reported by the failing rule', () => {
  const problems = problemsOf(seeded((dom) => (row(dom, 'workloads', 'Jobs')[3] = 'None failing')));
  assert.match(problems.join('\n'), /^failing: Jobs: the page says "None failing", wanted "1" \(kubectl lists 1 failing\)$/m);
});

test('control failing: a count that is not the failing count, an at-least count after the set is whole, and a count where nothing fails are reported', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'workloads', 'Pods')[3] = '2'))), ['failing: Pods: the page says "2", wanted "3" (kubectl lists 3 failing)']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'workloads', 'Pods')[3] = '3+'))), ['failing: Pods: the page says "3+", wanted "3" (kubectl lists 3 failing)']);
  const rows = problemsOf(seeded((dom) => (row(dom, 'workloads', 'Deployments')[3] = '1')));
  assert.match(rows.join('\n'), /^failing: Deployments: the page says "1", wanted "None failing" \(kubectl lists 0 failing\)$/m);
});

test('control status: a stale Healthy, on a row of a kind that has a failing object, is reported by the status rule', () => {
  // The whole row is the one the page drew before the Job failed: Healthy, two Jobs, None failing.
  const problems = problemsOf(seeded((dom) => row(dom, 'workloads', 'Jobs').splice(1, 3, 'Healthy', '2', 'None failing')));
  assert.match(problems.join('\n'), /^status: Jobs: the page says "Healthy", wanted "Needs attention" \(kubectl lists 1 failing\)$/m);
});

test('control status: a row that still says Loading, or Needs attention for a kind that has none failing, is reported', () => {
  assert.match(problemsOf(seeded((dom) => (row(dom, 'workloads', 'CronJobs')[1] = 'Loading'))).join('\n'), /^status: CronJobs: the page says "Loading", wanted "Healthy" \(kubectl lists 0 failing\)$/m);
  assert.match(problemsOf(seeded((dom) => (row(dom, 'workloads', 'Deployments')[1] = 'Needs attention'))).join('\n'), /^status: Deployments: the page says "Needs attention", wanted "Healthy" \(kubectl lists 0 failing\)$/m);
});

test('control healthy: a Healthy row is Healthy only over None failing, whatever kubectl says', () => {
  const dom = seeded((value) => (row(value, 'workloads', 'Jobs').splice(1, 3, 'Healthy', '2', '1')));
  assert.match(problemsOf(dom).join('\n'), /^healthy: Jobs says Healthy over "1": a Healthy row says None failing$/m);
  assert.deepEqual(frameProblems(readOverview(dom)), ['healthy: Jobs says Healthy over "1": a Healthy row says None failing']);
});

test('control workloads: a table that lacks a kind, or draws one more, is reported', () => {
  const lacking = problemsOf(seeded((dom) => (section(dom, 'workloads').rows = section(dom, 'workloads').rows.filter(([kind]) => kind !== 'Jobs'))));
  assert.match(lacking.join('\n'), /^workloads: the table has the kinds Pods, Deployments, StatefulSets, DaemonSets, CronJobs, wanted Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs$/m);
  const extra = problemsOf(seeded((dom) => section(dom, 'workloads').rows.push(['Secrets', 'Healthy', '3', 'None failing'])));
  assert.match(extra.join('\n'), /^workloads: the table has the kinds .*, Secrets, wanted /m);
});

test('control cluster: a row that is not what kubectl and the kubeconfig say is reported by the cluster rule, each of the four', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'cluster', 'Kubernetes version')[1] = 'v1.34.0'))), ['cluster: Kubernetes version: the page says "v1.34.0", kubectl lists "v1.35.0"']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'cluster', 'Nodes')[1] = '1 · 0 ready'))), ['cluster: Nodes: the page says "1 · 0 ready", kubectl lists "1 · 1 ready"']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'cluster', 'Namespaces')[1] = '7'))), ['cluster: Namespaces: the page says "7", kubectl lists "8"']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'cluster', 'API server')[1] = 'https://127.0.0.1:6443'))), ['cluster: API server: the page says "https://127.0.0.1:6443", kubectl lists "https://127.0.0.1:55981"']);
});

test('control cluster: a row that is missing, one that still says Loading and a section that is not drawn are reported', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (section(dom, 'cluster').rows = section(dom, 'cluster').rows.filter(([label]) => label !== 'Namespaces')))), ['cluster: no row "Namespaces"']);
  assert.deepEqual(problemsOf(seeded((dom) => (row(dom, 'cluster', 'Nodes')[1] = 'Loading'))), ['cluster: Nodes: the page says "Loading", kubectl lists "1 · 1 ready"']);
  assert.match(problemsOf(seeded((dom) => (dom.sections = dom.sections.filter((entry) => entry.id !== 'cluster')))).join('\n'), /^sections: the page draws attention, workloads, wanted attention, workloads, cluster$/m);
});

test('control sections: a Needs attention section where nothing fails, and none where something does, are each reported', () => {
  assert.match(problemsOf(seeded((dom) => (dom.sections = dom.sections.filter((entry) => entry.id !== 'attention')))).join('\n'), /^sections: the page draws workloads, cluster, wanted attention, workloads, cluster$/m);
  const quiet = oracle({ pods: PODS.filter((entry) => !['Error', 'ErrImagePull', 'CrashLoopBackOff'].includes(entry.status)), objects: OBJECTS.filter((entry) => entry.metadata.name !== 'broken-migration') });
  assert.match(problemsOf(SETTLED, quiet).join('\n'), /^sections: the page draws attention, workloads, cluster, wanted workloads, cluster$/m);
});

test('control summary: Everything is running where kubectl lists failing objects, the wrong count, no summary and a summary still checking are each reported', () => {
  assert.match(problemsOf(seeded((dom) => (dom.summary = ['Everything is running']))).join('\n'), /^summary: the page says "Everything is running", wanted "Needs attention · 4 failing"$/m);
  assert.match(problemsOf(seeded((dom) => (dom.summary = ['Needs attention', '3 failing']))).join('\n'), /^summary: the page says "Needs attention · 3 failing", wanted "Needs attention · 4 failing"$/m);
  assert.match(problemsOf(seeded((dom) => (dom.summary = null))).join('\n'), /^summary: the page draws no summary line, wanted "Needs attention · 4 failing"$/m);
  assert.match(problemsOf(seeded((dom) => (dom.summary = ['Checking', 'Not checked in full yet: Pods']))).join('\n'), /^summary: the page says "Checking · Not checked in full yet: Pods", wanted "Needs attention · 4 failing"$/m);
});

test('control tab: no tab, the landing alone, the Overview alone, another page\'s tab, a third tab, the tabs the other way round and an Overview that is not on screen are each reported by the tab rule', () => {
  const landing = { title: 'Kubernetes', name: 'Kubernetes', selected: false };
  const overview = { title: 'Overview', name: 'Overview, kind-hm3-pin', selected: true };
  const pods = { title: 'Pods', name: 'Pods, kind-hm3-pin', selected: false };
  const wanted = 'wanted two tabs: the plugin\'s landing, titled "Kubernetes", then one titled "Overview", on screen';
  const tabsProblems = (...tabs) => problemsOf(seeded((dom) => (dom.tabs = tabs)));
  assert.deepEqual(tabsProblems(), [`tab: the window's tabs are [], ${wanted}`]);
  // The press on the connection opened nothing: the landing is the one tab. Or it opened the Overview in the landing's own tab, and the landing is gone.
  assert.deepEqual(tabsProblems({ ...landing, selected: true }), [`tab: the window's tabs are ["Kubernetes" on screen], ${wanted}`]);
  assert.deepEqual(tabsProblems(overview), [`tab: the window's tabs are ["Overview" on screen], ${wanted}`]);
  assert.deepEqual(tabsProblems(landing, { ...pods, selected: true }), [`tab: the window's tabs are ["Kubernetes", "Pods" on screen], ${wanted}`]);
  assert.deepEqual(tabsProblems(pods, overview), [`tab: the window's tabs are ["Pods", "Overview" on screen], ${wanted}`]);
  assert.deepEqual(tabsProblems(landing, overview, pods), [`tab: the window's tabs are ["Kubernetes", "Overview" on screen, "Pods"], ${wanted}`]);
  assert.deepEqual(tabsProblems(overview, landing), [`tab: the window's tabs are ["Overview" on screen, "Kubernetes"], ${wanted}`]);
  assert.deepEqual(tabsProblems({ ...landing, selected: true }, { ...overview, selected: false }), [`tab: the window's tabs are ["Kubernetes" on screen, "Overview"], ${wanted}`]);
});

test('control heading: the connection\'s ID, another name, no heading and two headings are each reported by the heading rule, and the ID is named as the ID', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (dom.headings = [IDENTITY.id]))), [`heading: the page's heading is the connection's ID (${IDENTITY.id}), where a person reads its name "kind-hm3-pin"`]);
  assert.deepEqual(problemsOf(seeded((dom) => (dom.headings = ['Overview']))), ['heading: the page\'s heading is "Overview", the connection\'s name is "kind-hm3-pin" (the context kubectl calls current)']);
  assert.match(problemsOf(seeded((dom) => (dom.headings = ['kind-other-0123456789']))).join('\n'), /the text is shaped like a derived ID \(<slug>-<10 hex>\)/);
  assert.deepEqual(problemsOf(seeded((dom) => (dom.headings = []))), ['heading: the page has no heading of level 1, wanted one: the connection\'s name "kind-hm3-pin"']);
  assert.deepEqual(problemsOf(seeded((dom) => (dom.headings = ['kind-hm3-pin', 'Overview']))), ['heading: the page has 2 headings of level 1 (kind-hm3-pin, Overview), wanted one: the connection\'s name "kind-hm3-pin"']);
});

test('control heading: a context kubectl does not name cannot be compared, and is a problem and never a pass', () => {
  assert.match(problemsOf(SETTLED, oracle(), { context: undefined, id: undefined }).join('\n'), /^heading: kubectl has no current context, so the check cannot compare the heading$/m);
});

test('control sidebar: another entry current, none, and two are each reported by the sidebar rule', () => {
  assert.deepEqual(problemsOf(seeded((dom) => (dom.current = ['Pods']))), ['sidebar: the current entries are ["Pods"], wanted only "Overview"']);
  assert.deepEqual(problemsOf(seeded((dom) => (dom.current = []))), ['sidebar: the current entries are [], wanted only "Overview"']);
  assert.deepEqual(problemsOf(seeded((dom) => (dom.current = ['Overview', 'Nodes']))), ['sidebar: the current entries are ["Overview","Nodes"], wanted only "Overview"']);
});

test('control: the page of the plugin before the Overview, a list of Pods, and the plugin\'s landing where the connection was never opened are reported by every rule that can see them, and pass none', () => {
  const pods = { tabs: [{ title: 'Pods', name: 'Pods', selected: true }], headings: [], current: ['Pods'], summary: null, sections: [] };
  const landing = { tabs: [{ title: 'Kubernetes', name: 'Kubernetes', selected: true }], headings: ['Kubernetes'], current: [], summary: null, sections: [] };
  for (const dom of [pods, landing]) {
    const problems = problemsOf(dom);
    for (const rule of ['tab', 'heading', 'sidebar', 'sections', 'summary']) {
      assert.match(problems.join('\n'), new RegExp(`^${rule}: `, 'm'), rule);
    }
  }
});

// --- the frames while it loads ----------------------------------------------------------------------------------------------------------------------------------------

const LOADING_SUMMARY = ['Checking', 'Not checked in full yet: Pods, Deployments, StatefulSets, DaemonSets, Jobs, PersistentVolumeClaims, Nodes'];
const workloads = (...rows) => ({ id: 'workloads', title: 'Workloads', meta: '', kind: 'table', head: ['Kind', 'Status', 'Total', 'Failing'], rows });
const cluster = (...rows) => ({ id: 'cluster', title: 'Cluster', meta: '', kind: 'kv', rows });
const frame = (summary, table, rows) => ({ tabs: SETTLED.tabs, headings: ['kind-hm3-pin'], current: ['Overview'], summary, sections: [workloads(...table), cluster(...rows)] });
const NOTHING_YET = WORKLOAD_KINDS.map((kind) => [kind, 'Loading', '—', '—']);
const LOADING_ROWS = CLUSTER_LABELS.map((label) => [label, 'Loading']);

// What the page printed, in the order it printed it, between the press and the settled page (a real run: the host's own connection start, then each kind's first page, then its whole set).
const REAL_FRAMES = [
  frame(LOADING_SUMMARY, NOTHING_YET, LOADING_ROWS),
  frame(LOADING_SUMMARY, NOTHING_YET, [['Kubernetes version', 'v1.35.0'], ['Nodes', 'Loading'], ['Namespaces', 'Loading'], ['API server', SERVER]]),
  frame(
    LOADING_SUMMARY,
    [['Pods', 'Loading', '9', 'Not checked'], ['Deployments', 'Loading', '2', 'Not checked'], ['StatefulSets', 'Loading', '0', '—'], ['DaemonSets', 'Loading', '2', 'Not checked'], ['Jobs', 'Loading', '0', '—'], ['CronJobs', 'Loading', '0', '—']],
    [['Kubernetes version', 'v1.35.0'], ['Nodes', 'Loading'], ['Namespaces', 'Loading'], ['API server', SERVER]],
  ),
  frame(
    LOADING_SUMMARY,
    [['Pods', 'Loading', '9', 'Not checked'], ['Deployments', 'Loading', '2', 'Not checked'], ['StatefulSets', 'Loading', '0', '—'], ['DaemonSets', 'Loading', '2', 'Not checked'], ['Jobs', 'Loading', '0', '—'], ['CronJobs', 'Loading', '0', '—']],
    [['Kubernetes version', 'v1.35.0'], ['Nodes', '1 · 1 of the first 1 ready'], ['Namespaces', '5'], ['API server', SERVER]],
  ),
  frame(
    ['Checking', 'Not checked in full yet: Pods, StatefulSets, PersistentVolumeClaims, Nodes'],
    [['Pods', 'Loading', '9', 'Not checked'], ['Deployments', 'Healthy', '2', 'None failing'], ['StatefulSets', 'Loading', '0', '—'], ['DaemonSets', 'Healthy', '2', 'None failing'], ['Jobs', 'Healthy', '0', 'None failing'], ['CronJobs', 'Healthy', '0', 'None failing']],
    [['Kubernetes version', 'v1.35.0'], ['Nodes', '1 · 1 of the first 1 ready'], ['Namespaces', '5'], ['API server', SERVER]],
  ),
  // Where the fixture fails, a kind that has a failing object says so before its whole set is here: Needs attention, over a count that is at least that many.
  frame(
    ['Checking', 'Not checked in full yet: Pods, Jobs'],
    [['Pods', 'Needs attention', '25', '3+'], ['Deployments', 'Loading', '5', 'Not checked'], ['StatefulSets', 'Loading', '1', 'Not checked'], ['DaemonSets', 'Loading', '3', 'Not checked'], ['Jobs', 'Needs attention', '2', '1+'], ['CronJobs', 'Loading', '0', '—']],
    [['Kubernetes version', 'v1.35.0'], ['Nodes', '1 · 1 ready'], ['Namespaces', '8'], ['API server', SERVER]],
  ),
  frame(
    ['Everything is running'],
    WORKLOAD_KINDS.map((kind, index) => [kind, 'Healthy', ['9', '2', '0', '2', '0', '0'][index], 'None failing']),
    [['Kubernetes version', 'v1.35.0'], ['Nodes', '1 · 1 ready'], ['Namespaces', '5'], ['API server', SERVER]],
  ),
];

test('the frames a real page printed while it loaded break no rule: a dash, Not checked and an at-least count are what a row that has not finished may say', () => {
  for (const [index, dom] of REAL_FRAMES.entries()) {
    assert.deepEqual(frameProblems(readOverview(dom)), [], `frame ${String(index)}`);
  }
});

test('a frame is settled when its summary has stopped checking; a frame that draws no summary is not', () => {
  assert.deepEqual(REAL_FRAMES.map((dom) => isSettled(readOverview(dom))), [false, false, false, false, false, false, true]);
  assert.equal(isSettled(readOverview(SETTLED)), true);
});

test('a row that says Loading in a frame is counted: the frames of a real page, and the samples that read them', () => {
  const reads = REAL_FRAMES.map((dom, index) => ({ read: readOverview(dom), count: index + 1 }));
  assert.equal(hasLoadingRow(reads[0].read), true);
  assert.equal(hasLoadingRow(reads[6].read), false);
  assert.deepEqual(loadingFrames(reads), { distinct: 6, samples: 1 + 2 + 3 + 4 + 5 + 6 });
  assert.deepEqual(loadingFrames([]), { distinct: 0, samples: 0 });
  // A frame whose only Loading row is one of the Cluster section's is a frame that loads, as one whose only Loading row is the table's is.
  const clusterOnly = seeded((dom) => (row(dom, 'cluster', 'Nodes')[1] = 'Loading'), REAL_FRAMES[6]);
  assert.equal(hasLoadingRow(readOverview(clusterOnly)), true);
  assert.deepEqual(loadingFrames([{ read: readOverview(clusterOnly), count: 3 }]), { distinct: 1, samples: 3 });
});

test('control loading: a None failing on a row that says Loading is reported by the loading rule: a zero for a kind that has not been read', () => {
  const frames = seeded((dom) => (row(dom, 'workloads', 'Pods').splice(1, 3, 'Loading', '9', 'None failing')), REAL_FRAMES[2]);
  assert.deepEqual(frameProblems(readOverview(frames)), ['loading: Pods says Loading and its Failing says "None failing": a row that has not finished reads no zero']);
});

test('control loading: a number, a count of failing objects and a zero on a row that says Loading are reported, and a dash and Not checked are not', () => {
  const failing = (text) => frameProblems(readOverview(seeded((dom) => (row(dom, 'workloads', 'Jobs')[3] = text), REAL_FRAMES[2])));
  assert.deepEqual(failing('—'), []);
  assert.deepEqual(failing('Not checked'), []);
  for (const text of ['0', '1', '1+', 'Not available']) {
    assert.deepEqual(failing(text), [`loading: Jobs says Loading and its Failing says "${text}": a row that has not finished reads no zero`], text);
  }
});

test('control loading: a Cluster row that says Loading beside a number is reported by the loading rule', () => {
  const problems = frameProblems(readOverview(seeded((dom) => (row(dom, 'cluster', 'Nodes')[1] = 'Loading 0'), REAL_FRAMES[2])));
  assert.deepEqual(problems, ['loading: the Cluster row Nodes says Loading and shows a number ("Loading 0")']);
});

test('control loading: Everything is running while a row says Loading is reported by the loading rule, and names the rows', () => {
  const inFlight = seeded((dom) => {
    dom.summary = ['Everything is running'];
    row(dom, 'workloads', 'CronJobs').splice(1, 3, 'Loading', '0', '—');
  }, REAL_FRAMES[6]);
  assert.deepEqual(frameProblems(readOverview(inFlight)), ['loading: the summary says "Everything is running" while CronJobs says Loading']);
  const cluster = seeded((dom) => {
    dom.summary = ['Everything is running'];
    row(dom, 'cluster', 'Nodes')[1] = 'Loading';
  }, REAL_FRAMES[6]);
  assert.deepEqual(frameProblems(readOverview(cluster)), ['loading: the summary says "Everything is running" while Nodes says Loading']);
});

test('control loading: the settled comparison holds the frame rules too, so a settled page that says a zero for a row that says Loading is not an agreement', () => {
  const settled = seeded((dom) => (row(dom, 'workloads', 'CronJobs').splice(1, 3, 'Loading', '0', 'None failing')));
  assert.match(problemsOf(settled).join('\n'), /^loading: CronJobs says Loading and its Failing says "None failing"/m);
});
