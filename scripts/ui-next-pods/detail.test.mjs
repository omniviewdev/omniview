import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDetail, DETAIL_POD, detailHref, expectedDetail } from './detail.mjs';

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
