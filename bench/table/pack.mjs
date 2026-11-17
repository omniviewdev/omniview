// Packs bench/table/results/<dir> into docs/ui-next/baseline/raw/1a3b/ so that the numbers of a baseline file can be recomputed:
//   <dir>.trials.jsonl.gz   one trial per line (run.mjs), the arrays of frame intervals and frame work included
//   <dir>.meta.json         what run.mjs wrote beside them: the command, the page identity, the corpus hashes, the environment
//   <dir>.<file>.json[.gz]  the other results (counts.json, w3.json, fit.json, a11y.json), gzipped when over 100 KB
//
//   node bench/table/pack.mjs [dir ...]            # default: every directory under bench/table/results except the shakedowns
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { here, repo } from './lib.mjs';

const results = path.join(here, 'results');
const target = path.join(repo, 'docs/ui-next/baseline/raw/1a3b');
mkdirSync(target, { recursive: true });
const wanted = process.argv.slice(2);
const directories = (wanted.length > 0 ? wanted : readdirSync(results)).filter((name) => !name.startsWith('shake') && statSync(path.join(results, name)).isDirectory());

for (const directory of directories) {
  const full = path.join(results, directory);
  const files = readdirSync(full);
  const trials = files.filter((name) => name.startsWith('trial-')).sort();
  if (trials.length > 0) {
    const lines = trials.map((name) => JSON.stringify(JSON.parse(readFileSync(path.join(full, name), 'utf8'))));
    writeFileSync(path.join(target, `${directory}.trials.jsonl.gz`), gzipSync(`${lines.join('\n')}\n`, { level: 9 }));
  }

  for (const name of files.filter((entry) => entry.endsWith('.json') && !entry.startsWith('trial-'))) {
    const text = readFileSync(path.join(full, name));
    const stem = name === 'meta.json' ? `${directory}.meta.json` : `${directory}.${name}`;
    if (text.length > 100 * 1024) {
      writeFileSync(path.join(target, `${stem}.gz`), gzipSync(text, { level: 9 }));
    } else {
      writeFileSync(path.join(target, stem), text);
    }
  }

  process.stdout.write(`${directory}: ${trials.length} trials\n`);
}

if (!existsSync(target)) {
  throw new Error('nothing packed');
}
