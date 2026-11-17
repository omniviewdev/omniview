import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatAge } from './fields';
import { podRow } from './row';
import { hostRecord } from './testing';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Pod object
// and the cells the server printed for it, taken together (fixtures/pods-table.json). `kubectl get pods -A` prints these cells.

type Capture = {
  readonly label: string;
  readonly serverDate: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<{ readonly cells: readonly string[]; readonly object: { readonly metadata: { readonly name: string; readonly namespace: string } } }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/pods-table.json'), 'utf8')) as { captures: readonly Capture[] };

// Where the plan and kubectl differ ON PURPOSE (status file 1a.2, E13): the plan counts regular containers only and shows a missing
// restart count as a dash. Each entry says what this layer shows; everything else must equal kubectl.
const DOCUMENTED: Readonly<Record<string, { readonly ready?: string; readonly restarts?: number | null }>> = {
  'states/sidecar': { ready: '1/1' }, // kubectl 2/2: it counts the native sidecar (a restartable init container)
  'states/init-fail': { restarts: 0 }, // kubectl 3: it counts the init container's restarts while the Pod initialises
  'checkout/unschedulable': { restarts: null }, // kubectl 0: no container status exists yet, which is a dash here (plan E4)
  'states/gated': { restarts: null }, // the same: not scheduled, no container status
};

const UNIT_SECONDS: Readonly<Record<string, number>> = { y: 365 * 86400, d: 86400, h: 3600, m: 60, s: 1 };

/** What kubectl's AGE says, in seconds: "6m12s" is 372, "3d5h" is 277200. */
function kubectlSeconds(age: string): number {
  return [...age.matchAll(/(\d+)([ydhms])/g)].reduce((sum, [, count, unit]) => sum + Number(count) * (UNIT_SECONDS[unit] ?? 0), 0);
}

/** The seconds our one-unit age stands for: "8m" is any time from 480 s up to, but not including, 540 s. */
function ageWindow(text: string): readonly [number, number] {
  const [, count, unit] = /^(\d+)([dhms])$/.exec(text) ?? [];
  const size = UNIT_SECONDS[unit ?? 's'] ?? 1;
  return [Number(count) * size, (Number(count) + 1) * size];
}

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly string[], name: string) => cells[columns.indexOf(name)];

    for (const { cells, object } of capture.rows) {
      const id = `${object.metadata.namespace}/${object.metadata.name}`;
      const documented = DOCUMENTED[id];

      describe(id, () => {
        const row = podRow(hostRecord(object));

        it('Ready', () => {
          expect(row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`).toBe(documented?.ready ?? cell(cells, 'Ready'));
        });

        it('Status: the word kubectl prints', () => {
          expect(row.status?.word).toBe(cell(cells, 'Status'));
        });

        it('Restarts: the number kubectl prints, before its "(5m ago)"', () => {
          const printed = Number.parseInt(cell(cells, 'Restarts'), 10);

          expect(row.restarts).toBe(documented !== undefined && 'restarts' in documented ? (documented.restarts ?? undefined) : printed);
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const age = formatAge(row.createdAt!, now).text;
          const [from, to] = ageWindow(age);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Node and IP: kubectl prints <none> where there is nothing', () => {
          const printedNode = cell(cells, 'Node');
          const printedIP = cell(cells, 'IP');

          expect(row.node).toBe(printedNode === '<none>' ? undefined : printedNode);
          expect(row.ip).toBe(printedIP === '<none>' ? undefined : printedIP);
        });
      });
    }
  });
}

describe('the fixture covers the states the list has to show', () => {
  const words = new Set(golden.captures.flatMap((capture) => capture.rows.map(({ cells }) => cells[capture.columns.indexOf('Status')])));

  it('holds each state of the slice fixture and the extra ones', () => {
    for (const word of ['Running', 'Completed', 'Error', 'ErrImagePull', 'ImagePullBackOff', 'CrashLoopBackOff', 'Pending', 'Init:0/1', 'Init:Error', 'SchedulingGated', 'NotReady', 'OOMKilled', 'Terminating']) {
      expect(words, word).toContain(word);
    }
  });
});
