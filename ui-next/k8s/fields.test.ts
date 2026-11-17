import { describe, expect, it } from 'vitest';
import { formatAge, nameTail, podCreatedAt, podIP, podNode, podReady, podRestarts } from './fields';
import type { PodObject } from './pod';

// Ready, Restarts, Age, Node, IP and the tail of a generated name, from the object a cluster served (plan 1.3).
// A value the object does not hold is undefined, never zero, empty or "Unknown" (ch13 D7, E4 of the plan).

const status = (value: NonNullable<PodObject['status']>): PodObject => ({ status: value });

describe('podReady: regular containers that report ready, over the containers the spec declares', () => {
  it('counts the ready container statuses over spec.containers', () => {
    const pod: PodObject = {
      spec: { containers: [{ name: 'app' }, { name: 'proxy' }] },
      status: { containerStatuses: [{ name: 'app', ready: true }, { name: 'proxy', ready: false }] },
    };

    expect(podReady(pod)).toEqual({ ready: 1, total: 2 });
  });

  it('is 0 of N for a Pod that has no container status yet', () => {
    expect(podReady({ spec: { containers: [{ name: 'app' }] }, status: { phase: 'Pending' } })).toEqual({ ready: 0, total: 1 });
  });

  it('is undefined when the spec is missing', () => {
    expect(podReady({})).toBeUndefined();
    expect(podReady({ status: { containerStatuses: [{ name: 'app', ready: true }] } })).toBeUndefined();
  });

  it('does not count init containers, native sidecars included (the plan: regular containers only)', () => {
    const pod: PodObject = {
      spec: { containers: [{ name: 'app' }], initContainers: [{ name: 'side', restartPolicy: 'Always' }] },
      status: { containerStatuses: [{ name: 'app', ready: true }], initContainerStatuses: [{ name: 'side', ready: true }] },
    };

    expect(podReady(pod)).toEqual({ ready: 1, total: 1 });
  });
});

describe('podRestarts: the sum over the regular containers', () => {
  it('sums restartCount', () => {
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 2 }, { name: 'b', restartCount: 5 }] }))).toBe(7);
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 0 }] }))).toBe(0);
  });

  it('is undefined, not 0, when the container statuses are missing or one count is missing', () => {
    expect(podRestarts({})).toBeUndefined();
    expect(podRestarts(status({ phase: 'Pending' }))).toBeUndefined();
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 1 }, { name: 'b' }] }))).toBeUndefined();
  });

  it('leaves init container restarts out', () => {
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 1 }], initContainerStatuses: [{ name: 'i', restartCount: 9 }] }))).toBe(1);
  });
});

describe('podCreatedAt', () => {
  it('reads metadata.creationTimestamp as epoch milliseconds', () => {
    expect(podCreatedAt({ metadata: { creationTimestamp: '2026-11-16T20:00:00Z' } })).toBe(Date.UTC(2026, 10, 16, 20, 0, 0));
  });

  it('is undefined when it is missing or not a time', () => {
    expect(podCreatedAt({})).toBeUndefined();
    expect(podCreatedAt({ metadata: { creationTimestamp: 'yesterday' } })).toBeUndefined();
  });
});

describe('formatAge: one unit, rounded down (mock Cell.age; ch13 D5)', () => {
  const created = Date.UTC(2026, 10, 1, 9, 0, 0);
  const at = (seconds: number) => formatAge(created, created + seconds * 1000).text;

  it('is seconds below a minute, then minutes, hours and days', () => {
    expect(at(0)).toBe('0s');
    expect(at(42)).toBe('42s');
    expect(at(60)).toBe('1m');
    expect(at(3599)).toBe('59m');
    expect(at(3600)).toBe('1h');
    expect(at(86399)).toBe('23h');
    expect(at(86400 * 17 + 5)).toBe('17d');
  });

  it('gives the absolute time and the words in the long form', () => {
    const age = formatAge(created, created + 3 * 86400 * 1000);

    expect(age.long).toBe('2026-11-01 09:00 UTC · 3 days ago');
  });

  it('says in the future when the clock is behind the cluster', () => {
    const age = formatAge(created, created - 90 * 1000);

    expect(age.text).toBe('in 1m');
    expect(age.long).toBe('2026-11-01 09:00 UTC · in 1 minute');
  });
});

describe('podNode and podIP', () => {
  it('read spec.nodeName and status.podIP', () => {
    expect(podNode({ spec: { nodeName: 'node-1' } })).toBe('node-1');
    expect(podIP({ status: { podIP: '10.244.0.6' } })).toBe('10.244.0.6');
  });

  it('fall back to the first of status.podIPs, as kubectl prints it', () => {
    expect(podIP({ status: { podIPs: [{ ip: '10.244.0.7' }, { ip: 'fd00::7' }] } })).toBe('10.244.0.7');
  });

  it('are undefined for a Pod that is not scheduled or has no address', () => {
    expect(podNode({ spec: {} })).toBeUndefined();
    expect(podNode({ spec: { nodeName: '' } })).toBeUndefined();
    expect(podIP({ status: {} })).toBeUndefined();
    expect(podIP({})).toBeUndefined();
  });
});

describe('nameTail: the end of a generated name, kept whole when a cell has to cut the name', () => {
  it('is the length of the last dash group of up to ten letters and digits', () => {
    expect(nameTail('cart-api-86bf766589-78whc')).toBe('-78whc'.length);
    expect(nameTail('cart-cache-0')).toBe('-0'.length);
    expect(nameTail('nightly-report-mdxcg')).toBe('-mdxcg'.length);
  });

  it('is 0 when the name has no such tail', () => {
    expect(nameTail('crashloop')).toBe(0);
    expect(nameTail('')).toBe(0);
    expect(nameTail('a-very-long-name-with-a-0123456789abc')).toBe(0);
  });
});
