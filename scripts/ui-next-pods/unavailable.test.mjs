import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, parseAllDocuments } from 'yaml';
import { APISERVICE, compareAvailability, compareFacts, FACT, GROUP, GROUP_VERSION, MANIFEST, REASON, refusedRequests, VERSION } from './unavailable.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// What the host returns for the connection's facts (`ServiceWrapper.GetConnectionMetadata`: the envelope, then the SDK's snapshot) when the plugin has read a cluster with the one unavailable group.
const NAMED = { groups: [{ groupVersion: GROUP_VERSION, reason: REASON }], count: 1 };
const metadata = (entries, over = {}) => ({ pluginID: 'kubernetes', supported: true, transportAvailable: true, snapshot: { connectionID: 'kind-ui-next-pods-54c660ecd1', active: true, entries }, ...over });
const named = (value = NAMED, state = 'current') => metadata({ 'kubernetes.server_version': { state: 'current', value: 'v1.35.0' }, [FACT]: { state, value } });
const failure = (status, answered, asked = '') => ({ status, method: 'POST', path: '/wails/runtime', asked, answered });

// What the host answers a call it refuses with, as the real host wrote them (backend/pkg/apperror: the error as JSON in the `message` of a 422): the admission it refused before plugin #281 (what the demo drew as "Couldn't load Pods"),
// and a call the page itself cancelled.
const ADMISSION = '{"message":"{\\"type\\":\\"omniview:connection/failed\\",\\"title\\":\\"Source unavailable\\",\\"status\\":503,\\"detail\\":\\"Connection admission requires complete discovered support.\\",\\"code\\":\\"UNAVAILABLE\\"}"}';
const CANCELLED = '{"message":"{\\"type\\":\\"omniview:cancelled\\",\\"title\\":\\"Cancelled\\",\\"status\\":499,\\"detail\\":\\"The operation was cancelled.\\",\\"code\\":\\"CANCELLED\\"}"}';

test('a cluster whose APIService is Available=False because its Service has no endpoints is the cluster the check wants', () => {
  assert.deepEqual(compareAvailability('False/MissingEndpoints'), []);
  assert.deepEqual(compareAvailability('False/MissingEndpoints\n'), []);
});

test('negative control: a cluster that lacks the APIService, or has one that answers or fails for another reason, is reported and never taken for the unavailable group', () => {
  assert.deepEqual(compareAvailability(undefined), [`the cluster has no APIService ${APISERVICE}`]);
  for (const printed of ['', 'True/Passed', 'False/ServiceNotFound', 'False/FailedDiscoveryCheck', 'False', 'Unknown/']) {
    assert.deepEqual(compareAvailability(printed), [`the APIService ${APISERVICE} is not Available=False because of missing endpoints (its Available condition prints ${JSON.stringify(printed)})`]);
  }
});

test('a page whose requests all answered, and one whose only failure is its own cancelled query, made no refused request', () => {
  assert.deepEqual(refusedRequests([]), []);
  assert.deepEqual(refusedRequests([failure(422, CANCELLED, '{"args":{"methodID":1}}')]), []);
});

test('negative control: the admission the host refused (what the page drew as "Connection admission requires complete discovered support.") is a refused request, with what was asked and what came back', () => {
  const asked = '{"args":{"methodID":3276991559,"args":["kubernetes","kind-ui-next-pods-54c660ecd1"]}}';
  assert.deepEqual(refusedRequests([failure(422, ADMISSION, asked)]), [`POST /wails/runtime -> 422: asked ${asked} | answered ${ADMISSION}`]);
});

test('negative control: only a 422 that says CANCELLED is the page\'s own: another 422, a 400, a 404 and a 500 are refused whatever they say, and a cancelled one in a list does not hide the refusal beside it', () => {
  assert.equal(refusedRequests([failure(422, 'omniview:resource/forbidden')]).length, 1);
  assert.equal(refusedRequests([failure(422, '')]).length, 1);
  assert.equal(refusedRequests([failure(400, CANCELLED)]).length, 1, 'the status is part of the allowance');
  assert.equal(refusedRequests([failure(404, '')]).length, 1);
  assert.equal(refusedRequests([failure(500, CANCELLED)]).length, 1);
  assert.deepEqual(refusedRequests([failure(422, CANCELLED), failure(422, ADMISSION)]), [`POST /wails/runtime -> 422: asked  | answered ${ADMISSION}`], 'a cancelled query in a list does not hide the refusal beside it');
  assert.equal(refusedRequests([failure(422, undefined)]).length, 1, 'a body that could not be read is not a cancellation');
});

test('the facts that name the one unavailable group, as the host hands them over, agree (an object, or the text of one)', () => {
  assert.deepEqual(compareFacts(named()), []);
  assert.deepEqual(compareFacts(named(JSON.stringify(NAMED))), []);
});

test('negative control: no metadata, a plugin without the trait, and a snapshot with no facts are each reported and never pass', () => {
  assert.deepEqual(compareFacts(undefined), ['the host returned no connection metadata']);
  assert.deepEqual(compareFacts(null), ['the host returned no connection metadata']);
  assert.match(compareFacts({ ...named(), supported: false }).join('\n'), /does not support connection metadata/);
  assert.match(compareFacts({ ...named(), snapshot: undefined }).join('\n'), /carries no facts \(transportAvailable true\)/);
  assert.match(compareFacts({ ...named(), transportAvailable: false, snapshot: { entries: null } }).join('\n'), /carries no facts \(transportAvailable false\)/);
});

test('negative control: the plugin that names no unavailable group (the fact is absent, as it is when every group answers, and as it was before #281) is reported with the facts it does have', () => {
  assert.deepEqual(compareFacts(metadata({ 'kubernetes.server_version': { state: 'current', value: 'v1.35.0' } })), [`the connection has no fact ${FACT}: the plugin named no unavailable group (the facts it has: kubernetes.server_version)`]);
  assert.match(compareFacts(metadata({}))[0], /the facts it has: none/);
});

test('negative control: a fact that is not current, a value that is not {count, groups}, and text that is not JSON are each reported', () => {
  assert.match(compareFacts(named(NAMED, 'unavailable')).join('\n'), /is "unavailable", not current/);
  assert.match(compareFacts(named('not json')).join('\n'), /is not \{count, groups\}: "not json"/);
  assert.match(compareFacts(named(42)).join('\n'), /is not \{count, groups\}: 42/);
  assert.match(compareFacts(named({ count: 1 })).join('\n'), /is not \{count, groups\}/);
  assert.match(compareFacts(named(null)).join('\n'), /is not \{count, groups\}: null/);
});

test('negative control: the wrong group, a second group, no group, another reason and a wrong count are each reported, each with what the fact says', () => {
  const group = (groupVersion, reason = REASON) => ({ groupVersion, reason });
  const says = (groups, count = groups.length) => compareFacts(named({ groups, count })).join('\n');
  assert.equal(says([group('metrics.k8s.io/v1beta1')]), `the fact ${FACT} names metrics.k8s.io/v1beta1 (stale); the cluster's one unavailable group is ${GROUP_VERSION} (stale)`);
  assert.match(says([group(GROUP_VERSION), group('metrics.k8s.io/v1beta1')]), new RegExp(`names ${GROUP_VERSION.replaceAll('.', '\\.')} \\(stale\\), metrics\\.k8s\\.io/v1beta1 \\(stale\\);`));
  assert.match(says([]), /names no group/);
  assert.match(says([group(GROUP_VERSION, 'timeout')]), /\(timeout\); the cluster's one unavailable group is .+ \(stale\)/);
  assert.match(says([group(GROUP_VERSION, 'failed')]), /\(failed\)/);
  assert.match(says([group(GROUP_VERSION)], 2), /counts 2 unavailable group versions; the cluster has 1/);
  assert.match(compareFacts(named({ groups: NAMED.groups })).join('\n'), /counts undefined unavailable group versions/);
});

test('the manifest is the one the check names: a Service that selects no Pod of the fixture, and the APIService of that group and version that points at it', () => {
  const documents = parseAllDocuments(readFileSync(MANIFEST, 'utf8')).map((document) => document.toJS());
  assert.equal(documents.length, 2, 'a Service and an APIService');
  const [service, apiService] = documents;
  assert.equal(service.kind, 'Service');
  assert.equal(apiService.kind, 'APIService');
  assert.equal(apiService.metadata.name, APISERVICE);
  assert.equal(apiService.metadata.name, `${VERSION}.${GROUP}`);
  assert.equal(apiService.spec.group, GROUP);
  assert.equal(apiService.spec.version, VERSION);
  assert.deepEqual(apiService.spec.service, { name: service.metadata.name, namespace: service.metadata.namespace, port: service.spec.ports[0].port });
  assert.equal(Object.keys(service.spec.selector).length, 1, 'one label');
  const label = Object.values(service.spec.selector)[0];
  assert.ok(!readFileSync(path.join(repo, 'docs/ui-next/slices/1a-pods-list/fixture.yaml'), 'utf8').includes(label), `no Pod of the fixture carries the Service's selector (${label}): the Service has no endpoints`);
});

// The order is the proof that the plugin connects AFTER the group is registered: the control runs on the cluster as the earlier steps left it (no such group), the group is registered and seen to be unavailable, and only then does
// the host that connects start; the check that reads its page and its facts is the step after that. The host the earlier checks used started before, and has nothing to do with it.
test('the workflow registers the manifest and waits for the APIService to be unavailable before it starts the host that connects, and runs the control before it registers anything', () => {
  const steps = parse(readFileSync(path.join(repo, '.github/workflows/ui-next-pods.yml'), 'utf8')).jobs['pods-cluster'].steps;
  const at = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    assert.notEqual(index, -1, `the workflow has no step "${name}"`);
    return index;
  };
  const control = at('Negative control, a cluster without the unavailable API group');
  const register = at('Register an API group that cannot answer');
  const start = at('Start a host for the cluster with the unavailable API group');
  const check = at('Check that the connection starts with an unavailable API group');
  assert.ok(at('Check that the page and kubectl agree') < control && control < register && register < start && start < check, 'control, register, start, check, in that order after the main check');
  assert.match(steps[register].run, /kubectl apply -f scripts\/ui-next-pods\/unavailable-group\.yaml/);
  assert.ok(steps[register].run.includes(`kubectl wait --for=condition=Available=false apiservice/${APISERVICE} `), 'the step waits for the APIService it registered to be Available=False');
  assert.equal(steps[control].env.OMNIVIEW_CHECK_MODE, 'control-group-absent');
  assert.equal(steps[check].env.OMNIVIEW_CHECK_MODE, 'unavailable-group');
  assert.match(steps[start].run, /host\.sh start unavailable-group 34204 /);
  assert.equal(steps[check].env.OMNIVIEW_CHECK_BASE_URL, 'http://127.0.0.1:34204', 'the check reads the host that started after the group was registered');
  assert.equal(steps[control].env.OMNIVIEW_CHECK_BASE_URL, 'http://127.0.0.1:34201', 'the control reads the host of the main check, on the cluster that has no such group');
});
