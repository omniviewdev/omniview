import { describe, expect, it } from 'vitest';
import { podDefinition } from './definition';
import { podRow, type PodRow } from './row';
import { hostRecord } from './testing';

// The Pod definition has the shape of the mock's definition record (docs/ui-next/slices/1a-pods-list.md 2.4, MOCK
// k8s-resource-definitions.js:1053-1086): columns, the list rules, and one display function per field that answers a Cell.

const NOW = Date.UTC(2026, 10, 16, 20, 0, 0);

const row = (object: unknown) => podRow(hostRecord(object));
const running = row({
  metadata: { name: 'cart-api-86bf766589-78whc', namespace: 'checkout', creationTimestamp: '2026-10-30T20:00:00Z' },
  spec: { nodeName: 'node-1', containers: [{ name: 'app' }, { name: 'proxy' }] },
  status: {
    phase: 'Running',
    podIP: '10.244.0.6',
    containerStatuses: [
      { name: 'app', ready: true, restartCount: 1234, state: { running: {} } },
      { name: 'proxy', ready: true, restartCount: 0, state: { running: {} } },
    ],
  },
});
const bare = row({ metadata: { name: 'crashloop' } });

describe('the definition', () => {
  it('names the type and the kind', () => {
    expect(podDefinition).toMatchObject({ type: 'k8s:/pods', kind: 'Pod', nouns: { one: 'Pod', other: 'Pods' } });
  });

  it('lists the columns in the printer order: the identity, Ready, Status, Restarts, Age, then Node and IP in the chooser', () => {
    expect(podDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['ready', 'Ready', false],
      ['status', 'Status', false],
      ['restarts', 'Restarts', false],
      ['age', 'Age', false],
      ['node', 'Node', true],
      ['ip', 'IP', true],
    ]);
  });

  it('gives each column the width, fit, alignment and sort of the mock', () => {
    const by = Object.fromEntries(podDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.ready).toMatchObject({ fit: 'fixed', width: 59, align: 'right', sort: 'ratio' });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 157, align: 'left', sort: 'text' });
    expect(by.restarts).toMatchObject({ fit: 'fixed', width: 72, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
    expect(by.node).toMatchObject({ fit: 'flex', width: 72, sort: 'text' });
    expect(by.ip).toMatchObject({ fit: 'fixed', width: 113, sort: 'text' });
  });

  it('has one display function for each column', () => {
    expect(podDefinition.fields.map((field) => field.id)).toEqual(podDefinition.columns.map((column) => column.id));
  });
});

describe('the list rules', () => {
  const { list } = podDefinition;

  it('sorts by Name, ascending, until told otherwise', () => {
    expect(list.defaultSort).toEqual({ id: 'name', direction: 'asc' });
  });

  it('puts the namespace under the name, and keeps the tail of a generated name whole', () => {
    expect(list.identity.second(running)).toBe('checkout');
    expect(list.identity.second(bare)).toBeNull();
    expect(list.identity.tail(running)).toBe('-78whc'.length);
    expect(list.identity.tail(bare)).toBe(0);
  });

  it('has four quick filters in the user\'s words', () => {
    expect(list.quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['running', 'Running', 'success'],
      ['pending', 'Pending', 'warning'],
      ['failed', 'Failed', 'error'],
      ['completed', 'Completed', 'muted'],
    ]);
  });

  describe('quick filters: Running is the word, Pending and Failed are roles, Completed is two words', () => {
    const withStatus = (phase: string, containerState?: Record<string, unknown>) =>
      row({ metadata: { name: 'x' }, spec: { containers: [{ name: 'a' }] }, status: { phase, ...(containerState ? { containerStatuses: [{ name: 'a', state: containerState }] } : {}) } });
    const matching = (target: PodRow) => list.quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

    it('files each word under one filter', () => {
      expect(matching(withStatus('Running', { running: {} }))).toEqual(['running']);
      expect(matching(withStatus('Pending'))).toEqual(['pending']);
      expect(matching(withStatus('Pending', { waiting: { reason: 'ContainerCreating' } }))).toEqual(['pending']);
      expect(matching(withStatus('Running', { waiting: { reason: 'CrashLoopBackOff' } }))).toEqual(['failed']);
      expect(matching(withStatus('Failed', { terminated: { exitCode: 1, reason: 'Error' } }))).toEqual(['failed']);
      expect(matching(withStatus('Failed', { terminated: { exitCode: 137, reason: 'OOMKilled' } }))).toEqual(['failed']);
      expect(matching(withStatus('Succeeded', { terminated: { exitCode: 0, reason: 'Completed' } }))).toEqual(['completed']);
      expect(matching(withStatus('Succeeded'))).toEqual(['completed']);
    });

    it('counts a word that has no role in none of them, and a row without a status in none', () => {
      expect(matching(row({ metadata: { name: 'x' }, status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }] } }))).toEqual([]);
      expect(matching(bare)).toEqual([]);
    });
  });

  it('offers the Node facet, with the values the rows hold', () => {
    const [facet] = list.facets;

    expect(facet).toMatchObject({ id: 'node', label: 'Node', all: 'All nodes' });
    expect(facet.value(running)).toBe('node-1');
    expect(facet.value(bare)).toBeUndefined();
  });
});

describe('the cells', () => {
  const cell = (id: string, target = running, now = NOW) => podDefinition.fields.find((field) => field.id === id)!.display(target, now);

  it('shows the name as text, Ready as mono text, and Restarts grouped', () => {
    expect(cell('name')).toEqual({ kind: 'text', text: 'cart-api-86bf766589-78whc' });
    expect(cell('ready')).toEqual({ kind: 'text', text: '2/2', mono: true });
    expect(cell('restarts')).toEqual({ kind: 'text', text: '1,234', mono: true });
  });

  it('draws the status with its role, and a word without a role as plain text', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Running', label: 'Running', role: 'running' });
    const gated = row({ metadata: { name: 'g' }, status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }] } });

    expect(cell('status', gated)).toEqual({ kind: 'text', text: 'SchedulingGated' });
  });

  it('shows the age in one unit, and the absolute time for the tip', () => {
    expect(cell('age')).toEqual({ kind: 'age', createdAt: Date.UTC(2026, 9, 30, 20, 0, 0), text: '17d', long: '2026-10-30 20:00 UTC · 17 days ago' });
  });

  it('shows the node, and the address as mono text', () => {
    expect(cell('node')).toEqual({ kind: 'text', text: 'node-1' });
    expect(cell('ip')).toEqual({ kind: 'text', text: '10.244.0.6', mono: true });
  });

  it('shows a dash with its reason where a value is missing, never 0 or an invented word (ch13 D7)', () => {
    for (const id of ['ready', 'status', 'restarts', 'age', 'node', 'ip']) {
      const missing = cell(id, bare);

      expect(missing.kind, id).toBe('none');
      expect(missing, id).toMatchObject({ reason: expect.stringMatching(/\S/) as string });
    }
  });
});
