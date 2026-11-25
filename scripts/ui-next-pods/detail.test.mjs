import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { compareDeployment, compareDetail, compareGone, goneDeployment, DETAIL_DEPLOYMENT, DETAIL_POD, deploymentHref, detailHref, expectedDeployment, expectedDetail, linkTo } from './detail.mjs';

const pod = (name, nodeName, ip, qosClass) => ({
  metadata: { name },
  spec: { nodeName },
  status: { podIPs: [{ ip }], podIP: ip, hostIP: '172.18.0.2', qosClass },
});
const cacheZero = pod('cart-cache-0', 'kind-control-plane', '10.244.0.7', 'BestEffort');
const cacheOne = pod('cart-cache-1', 'kind-worker', '10.244.1.9', 'Burstable');

/** What the page reads when it prints exactly `pod`. */
const reading = (value) => ({
  h1: value.metadata.name,
  kv: [
    ['Node', value.spec.nodeName],
    ['Pod IP', value.status.podIP],
    ['Host IP', value.status.hostIP],
    ['QoS class', value.status.qosClass],
    ['Service account', 'default'],
  ],
});

test('the route is the one the Pods list links to', () => {
  assert.equal(detailHref(DETAIL_POD), '#/kubernetes/pod?namespace=checkout&name=cart-cache-0');
});

// The links of a page read in the connection opened from the plugin's landing carry its derived ID first (`ui-next/plugins/host/links.ts`); one read in no named connection carries none. A selector, so it is tried on a DOM.
test('linkTo selects the link of an object whatever connection the link carries, and the link of no other object, namespace or page', () => {
  const id = 'kind-ui-next-pods-54c660ecd1';
  const links = [
    '#/kubernetes/pod?namespace=checkout&name=cart-cache-0',
    `#/kubernetes/pod?connection=${id}&namespace=checkout&name=cart-cache-0`,
    `#/kubernetes/pod?connection=${id}&namespace=checkout&name=cart-cache-1`,
    `#/kubernetes/pod?connection=${id}&namespace=monitoring&name=cart-cache-0`,
    `#/kubernetes/pod?connection=${id}&namespace=checkout&name=cart-cache-01`,
    `#/kubernetes/pod?connection=${id}&namespace=checkout&name=xcart-cache-0`,
    `#/kubernetes/deployment?connection=${id}&namespace=checkout&name=cart-cache-0`,
  ];
  const { document } = new JSDOM(links.map((href, index) => `<a id="link${String(index)}" href="${href}">a</a>`).join('')).window;
  const found = (selector) => [...document.querySelectorAll(selector)].map((link) => link.id);
  assert.deepEqual(found(linkTo(detailHref(DETAIL_POD))), ['link0', 'link1']);
  assert.deepEqual(found(linkTo(deploymentHref(DETAIL_POD))), ['link6']);
});

test('expectedDetail reads the plain values of a Pod, with several IPs joined as the page joins them', () => {
  assert.deepEqual(expectedDetail(cacheZero), { name: 'cart-cache-0', node: 'kind-control-plane', podIP: '10.244.0.7', hostIP: '172.18.0.2', qos: 'BestEffort' });
  const dual = { ...cacheZero, status: { ...cacheZero.status, podIPs: [{ ip: '10.244.0.7' }, { ip: 'fd00::7' }] } };
  assert.equal(expectedDetail(dual).podIP, '10.244.0.7, fd00::7');
});

test('a page that prints what kubectl says agrees', () => {
  assert.deepEqual(compareDetail(reading(cacheZero), expectedDetail(cacheZero)), []);
  assert.deepEqual(compareDetail({ ...reading(cacheZero), kv: [...reading(cacheZero).kv.map(([l, v]) => (l === 'Pod IP' ? ['Pod IPs', v] : [l, v]))] }, expectedDetail(cacheZero)), []);
});

test('negative control: the page of another Pod does not agree with kubectl on this one', () => {
  const problems = compareDetail(reading(cacheOne), expectedDetail(cacheZero));
  assert.equal(problems.length, 4, problems.join('; '));
  assert.match(problems.join('\n'), /name: the page says "cart-cache-1", kubectl says "cart-cache-0"/);
  assert.match(problems.join('\n'), /Node: /);
  assert.match(problems.join('\n'), /Pod IP: /);
  assert.match(problems.join('\n'), /QoS class: /);
});

test('negative control: one changed character in one field is reported', () => {
  const read = reading(cacheZero);
  read.kv[1] = ['Pod IP', '10.244.0.8'];
  assert.deepEqual(compareDetail(read, expectedDetail(cacheZero)), ['Pod IP: the page says "10.244.0.8", kubectl says "10.244.0.7"']);
});

test('a missing row, or a Pod kubectl has no value for, is a problem and never a pass', () => {
  const read = reading(cacheZero);
  read.kv = read.kv.filter(([label]) => label !== 'Node');
  assert.match(compareDetail(read, expectedDetail(cacheZero)).join('\n'), /Node: the page says null/);
  const unscheduled = { ...cacheZero, spec: {} };
  assert.match(compareDetail(reading(cacheZero), expectedDetail(unscheduled)).join('\n'), /Node: kubectl has no value/);
});

// The generic detail page of a Deployment (K2c-2): opened from the Deployments list, its Details rows say what `kubectl get deployment -o json` says.
const deployment = (name, { revision = '1', limit = 10, strategy = { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } } } = {}) => ({
  metadata: { name, namespace: 'checkout', annotations: { 'deployment.kubernetes.io/revision': revision } },
  spec: { replicas: 3, revisionHistoryLimit: limit, strategy },
});
const cartApi = deployment('cart-api');

/** What the page reads when it prints exactly `value`'s rows. */
const deploymentReading = (value, over = {}) => ({
  h1: value.metadata.name,
  kv: [
    ['Strategy', 'Rolling update · max surge 25%, max unavailable 25%'],
    ['Revision', value.metadata.annotations['deployment.kubernetes.io/revision']],
    ['Selector', 'app=cart-api'],
    ['Revision history', `${String(value.spec.revisionHistoryLimit)} revisions`],
  ],
  ...over,
});

test('the Deployment route is the one the Deployments list links to', () => {
  assert.deepEqual(DETAIL_DEPLOYMENT, { namespace: 'checkout', name: 'cart-api' });
  assert.equal(deploymentHref(DETAIL_DEPLOYMENT), '#/kubernetes/deployment?namespace=checkout&name=cart-api');
});

test('expectedDeployment reads the strategy, the revision and the history limit as the page words them', () => {
  assert.deepEqual(expectedDeployment(cartApi), { name: 'cart-api', strategy: 'Rolling update · max surge 25%, max unavailable 25%', revision: '1', history: '10 revisions' });
  assert.equal(expectedDeployment(deployment('x', { limit: 1 })).history, '1 revision');
  assert.equal(expectedDeployment(deployment('x', { strategy: { type: 'Recreate' } })).strategy, 'Recreate');
  assert.equal(expectedDeployment(deployment('x', { strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } } })).strategy, 'Rolling update · max surge 1, max unavailable 0');
});

test('a page that prints what kubectl says of the Deployment agrees', () => {
  assert.deepEqual(compareDeployment(deploymentReading(cartApi), expectedDeployment(cartApi)), []);
});

test('negative control: the page of another Deployment, or of an older revision, does not agree', () => {
  const other = deployment('payment-gateway', { revision: '4', limit: 3 });
  const problems = compareDeployment(deploymentReading(other), expectedDeployment(cartApi));
  assert.equal(problems.length, 3, problems.join('; '));
  assert.match(problems.join('\n'), /name: the page says "payment-gateway", kubectl says "cart-api"/);
  assert.match(problems.join('\n'), /Revision: the page says "4", kubectl says "1"/);
  assert.match(problems.join('\n'), /Revision history: the page says "3 revisions", kubectl says "10 revisions"/);
});

test('negative control: a page that has no Details rows, as the Deployments list of a plugin without the page, is reported for each row and never passes', () => {
  const problems = compareDeployment({ h1: null, kv: [] }, expectedDeployment(cartApi));
  assert.equal(problems.length, 4, problems.join('; '));
  assert.match(problems.join('\n'), /Strategy: the page says null/);
});

test('negative control: one changed character in the strategy is reported, and a value kubectl does not have is a problem and never a pass', () => {
  const read = deploymentReading(cartApi);
  read.kv[0] = ['Strategy', 'Rolling update · max surge 25%, max unavailable 26%'];
  assert.deepEqual(compareDeployment(read, expectedDeployment(cartApi)), ['Strategy: the page says "Rolling update · max surge 25%, max unavailable 26%", kubectl says "Rolling update · max surge 25%, max unavailable 25%"']);
  const bare = { metadata: { name: 'cart-api' }, spec: {} };
  assert.match(compareDeployment(deploymentReading(cartApi), expectedDeployment(bare)).join('\n'), /Revision: kubectl has no value/);
});

// A Deployment deleted while its page is open (K2c-2, plugin #279): the title says it was deleted and the message says where it no longer exists, and nothing on the page says "not found".
test('the deleted Deployment is the check\'s own, in the namespace the fixture has, and its page says what the mock does', () => {
  assert.deepEqual(goneDeployment, { namespace: 'checkout', name: 'gone-check' });
  assert.notEqual(goneDeployment.name, DETAIL_DEPLOYMENT.name);
});

test('a page that titles the deleted Deployment "was deleted" over where it no longer exists agrees', () => {
  assert.deepEqual(compareGone({ h1: 'gone-check', title: 'gone-check was deleted', hint: 'It no longer exists in namespace checkout.' }, goneDeployment), []);
});

test('negative control: the earlier plugin\'s page, "was not found" over a body that says it was deleted, is reported (the page contradicted itself)', () => {
  const problems = compareGone({ h1: 'gone-check', title: 'gone-check was not found', hint: 'Deployment gone-check was deleted. It no longer exists in namespace checkout.' }, goneDeployment);
  assert.equal(problems.length, 2, problems.join('; '));
  assert.match(problems.join('\n'), /title: the page says "gone-check was not found", the page of a deleted object says "gone-check was deleted"/);
  assert.match(problems.join('\n'), /message: /);
});

test('negative control: a page that has no state yet, another object\'s title, and a wrong namespace are each reported', () => {
  assert.match(compareGone({ h1: 'gone-check', title: null, hint: null }, goneDeployment).join('\n'), /title: the page says null/);
  assert.match(compareGone({ h1: 'gone-check', title: 'cart-api was deleted', hint: 'It no longer exists in namespace checkout.' }, goneDeployment).join('\n'), /title: /);
  assert.match(compareGone({ h1: 'gone-check', title: 'gone-check was deleted', hint: 'It no longer exists in namespace monitoring.' }, goneDeployment).join('\n'), /message: /);
  assert.match(compareGone({ h1: 'other', title: 'gone-check was deleted', hint: 'It no longer exists in namespace checkout.' }, goneDeployment).join('\n'), /heading: /);
});
