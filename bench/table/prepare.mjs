// Turns the kind corpus into the row files the bench page loads, and records which files they came from.
//
//   node bench/table/prepare.mjs                      # corpus from $TABLE_CORPUS_DIR, else $TMPDIR/ui1a3-table, else /tmp/ui1a3-table; rows into bench/table/.cache/corpus/
//
// Output (all JSON, never committed):
//   rows-25.json, rows-1025.json, rows-5025.json   the real Pods of the kind cluster, as `podRowsFromList` makes rows (corpus/README.md)
//   rows-tail-5025.json                            the seeded long-tailed synthetic set of the same row shape (corpus/longTail.mjs)
//   corpus.json                                    the sha-256 and size of each source file, the counts, and the shape of each row set
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { longTailRows } from './corpus/longTail.mjs';
import { podRowsFromList } from './corpus/podRows.mjs';

const here = import.meta.dirname;
export const CACHE = path.join(here, '.cache', 'corpus');
// The same lookup as corpus/podRows.test.mjs: TABLE_CORPUS_DIR, else ${TMPDIR}/ui1a3-table, else /tmp/ui1a3-table.
const sourceDir = process.env.TABLE_CORPUS_DIR ?? [path.join(os.tmpdir(), 'ui1a3-table'), '/tmp/ui1a3-table'].find((directory) => existsSync(path.join(directory, 'pods-5025.json'))) ?? '/tmp/ui1a3-table';
const FILES = { 25: 'pods-fixture.json', 1025: 'pods-1025.json', 5025: 'pods-5025.json' };

/** What a row set looks like, so a report can say what was measured. */
function shape(rows) {
  const distinct = (pick) => new Set(rows.map(pick)).size;
  const defined = (pick) => rows.filter((row) => pick(row) !== undefined).length;
  const lengths = rows.map((row) => row.name.length).sort((a, b) => a - b);
  return {
    rows: rows.length,
    distinctNames: distinct((row) => row.name),
    distinctNamespaces: distinct((row) => row.namespace),
    distinctStatusWords: distinct((row) => row.status?.word),
    distinctNodes: distinct((row) => row.node),
    withNode: defined((row) => row.node),
    withIP: defined((row) => row.ip),
    withRestarts: defined((row) => row.restarts),
    nameLength: { min: lengths[0], median: lengths[lengths.length >> 1], max: lengths.at(-1) },
  };
}

export function prepare() {
  mkdirSync(CACHE, { recursive: true });
  const meta = { sourceDir, sources: {}, sets: {} };
  for (const [count, file] of Object.entries(FILES)) {
    const source = path.join(sourceDir, file);
    const text = readFileSync(source);
    const rows = podRowsFromList(JSON.parse(text.toString('utf8')));
    if (rows.length !== Number(count)) {
      throw new Error(`${source} holds ${rows.length} Pods, expected ${count}`);
    }

    writeFileSync(path.join(CACHE, `rows-${count}.json`), JSON.stringify(rows));
    meta.sources[file] = { sha256: createHash('sha256').update(text).digest('hex'), bytes: statSync(source).size };
    meta.sets[`rows-${count}`] = shape(rows);
  }

  const tail = longTailRows(5025);
  writeFileSync(path.join(CACHE, 'rows-tail-5025.json'), JSON.stringify(tail));
  meta.sets['rows-tail-5025'] = { ...shape(tail), generator: 'bench/table/corpus/longTail.mjs seed 7' };
  writeFileSync(path.join(CACHE, 'corpus.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

if (process.argv[1] === import.meta.filename) {
  process.stdout.write(`${JSON.stringify(prepare(), null, 2)}\n`);
}
