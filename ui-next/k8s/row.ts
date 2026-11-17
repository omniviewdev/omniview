import type { HostRecord } from '@omniviewdev/runtime';
import { nameTail, podCreatedAt, podIP, podNode, podReady, podRestarts, type PodReady } from './fields';
import { podObject } from './pod';
import { podStatusWord, stateRole, type StateRole } from './status';

export type PodStatus = {
  /** The platform's own word, spelled as kubectl prints it. */
  readonly word: string;
  /** Undefined when the table has no role for the word: it is drawn as plain text. */
  readonly role: StateRole | undefined;
};

/** What the list holds of one Pod. A field the object does not hold is undefined. */
export type PodRow = {
  /** `HostRecord.key`, the host's identity of the record. Neither the name nor any field mints one. */
  readonly key: string;
  readonly name: string;
  /** Empty when the object has none. */
  readonly namespace: string;
  /** Trailing characters of the name kept whole when it is cut. */
  readonly nameTail: number;
  readonly ready: PodReady | undefined;
  readonly status: PodStatus | undefined;
  readonly restarts: number | undefined;
  /** Epoch milliseconds. */
  readonly createdAt: number | undefined;
  readonly node: string | undefined;
  readonly ip: string | undefined;
};

// Rows are derived once per record OBJECT, never in render. The source view keeps every unchanged record as the same object, so a live
// update derives only the records that changed (18 µs a Pod, plan 2.2), and an unchanged array of records gives the same array of rows.
const rowOf = new WeakMap<HostRecord, PodRow>();
const rowsOf = new WeakMap<readonly HostRecord[], readonly PodRow[]>();
const searchOf = new WeakMap<PodRow, string>();

export function podRow(host: HostRecord): PodRow {
  let row = rowOf.get(host);
  if (row === undefined) {
    const pod = podObject(host);
    const word = podStatusWord(pod);
    const name = pod.metadata?.name ?? '';
    row = {
      key: host.key,
      name,
      namespace: pod.metadata?.namespace ?? '',
      nameTail: nameTail(name),
      ready: podReady(pod),
      status: word === undefined ? undefined : { word, role: stateRole(word) },
      restarts: podRestarts(pod),
      createdAt: podCreatedAt(pod),
      node: podNode(pod),
      ip: podIP(pod),
    };
    rowOf.set(host, row);
  }

  return row;
}

/** The rows of a page of records, in the order of the records. The same array in gives the same array out. */
export function podRows(records: readonly HostRecord[]): readonly PodRow[] {
  let rows = rowsOf.get(records);
  if (rows === undefined) {
    rows = records.map(podRow);
    rowsOf.set(records, rows);
  }

  return rows;
}

/** Everything a person can read in the row, in lower case, built the first time a search asks for it. */
export function podSearchText(row: PodRow): string {
  let text = searchOf.get(row);
  if (text === undefined) {
    const parts = [row.name, row.namespace, row.ready === undefined ? '' : `${row.ready.ready}/${row.ready.total}`, row.status?.word ?? '', row.restarts?.toString() ?? '', row.node ?? '', row.ip ?? ''];
    text = parts.filter((part) => part !== '').join('\n').toLowerCase();
    searchOf.set(row, text);
  }

  return text;
}
