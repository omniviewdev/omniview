// Verification-only exporter. Never copies/rewrites the P44 native bodies.
import { readFile, writeFile, mkdir, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(process.argv[2] ?? resolve(here, '../../../plugin-sdk'));
const launcher = process.argv[3];
if (!launcher) throw new Error('Usage: node export-corpus.mjs SDK_WORKTREE BASELINE_ENV');
const selected = 'da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7';
function run(binary, args, cwd) {
  const p = spawnSync(binary, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw new Error(`${binary} failed: ${p.error ?? p.stderr}`);
  return p.stdout;
}
const actual = run('git', ['rev-parse', 'HEAD'], sdk).trim();
if (actual !== selected) throw new Error(`P44 source must be exact ${selected}, got ${actual}`);
const sources = {};
for (const name of ['corpus.go', 'native.go', 'oracles.go']) {
  const relative = `internal/resourceconformance/${name}`;
  const content = await readFile(resolve(sdk, relative));
  const committed = run('git', ['show', `${selected}:${relative}`], sdk);
  if (!content.equals(Buffer.from(committed))) throw new Error(`P44 source modified: ${relative}`);
  sources[relative] = createHash('sha256').update(content).digest('hex');
}
const owned = resolve(sdk, `internal/resourceconformance/p01export${randomUUID().replaceAll('-', '')}`);
await mkdir(owned); // exclusive, no recursive adoption of existing directory
const entry = resolve(owned, 'main.go');
let created = false;
let bytes;
try {
  await writeFile(entry, `package main\nimport ("encoding/json"; "os"; c "github.com/omniviewdev/plugin-sdk/internal/resourceconformance")\nfunc main(){v:=c.NativeCorpus();if err:=v.Validate();err!=nil{panic(err)};if err:=json.NewEncoder(os.Stdout).Encode(v);err!=nil{panic(err)}}\n`, { flag: 'wx' });
  created = true;
  bytes = run(launcher, ['go', 'run', `./internal/resourceconformance/${owned.split('/').at(-1)}`], sdk);
} finally {
  if (created) await unlink(entry);
  await rmdir(owned); // never recursive; changed/unowned entries refuse cleanup
}
await writeFile(resolve(here, 'corpus.json'), bytes);
const provenance = { selectedSDK: actual, sources, corpusSHA256: createHash('sha256').update(bytes).digest('hex'), mechanism: 'NativeCorpus + Validate, SDK-internal temporary exporter; raw stdout preserved', temporaryExporterRemoved: true };
await writeFile(resolve(here, 'corpus-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance));
