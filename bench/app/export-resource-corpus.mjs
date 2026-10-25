#!/usr/bin/env node
// Verification-only: Go's internal importer runs inside the explicitly selected SDK.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'sdk-source': { type: 'string' }, out: { type: 'string' } } });
if (!values['sdk-source'] || !values.out) throw new Error('Require --sdk-source PATH --out PATH');
if (process.env.GOWORK !== 'off') throw new Error('Run with clean baseline-env and GOWORK=off');
const sdk = await realpath(values['sdk-source']);
const sha = execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expected = 'da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7';
if (sha !== expected) throw new Error(`SDK snapshot expects reviewed ${expected}, got ${sha}`);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const file of ['corpus.go', 'native.go']) {
  const relative = `internal/resourceconformance/${file}`;
  const bytes = await readFile(join(sdk, relative));
  const committed = execFileSync('git', ['-C', sdk, 'show', `${sha}:${relative}`]);
  if (!bytes.equals(committed)) throw new Error(`Corpus source differs from selected commit: ${relative}`);
  files[relative] = hash(bytes);
}
const temporary = await mkdtemp(join(sdk, 'p02-corpus-export-'));
try {
  await writeFile(join(temporary, 'main.go'), `package main
import (
  "encoding/json"
  "os"
  "github.com/omniviewdev/plugin-sdk/internal/resourceconformance"
)
func main() {
  c := resourceconformance.NativeCorpus()
  if err := c.Validate(); err != nil { panic(err) }
  if err := json.NewEncoder(os.Stdout).Encode(c); err != nil { panic(err) }
}
`, { flag: 'wx' });
  const corpus = execFileSync('go', ['run', '.'], { cwd: temporary, encoding: 'utf8', env: { ...process.env, GOWORK: 'off' }, maxBuffer: 8 * 1024 * 1024 });
  // Embed the Go-encoded raw corpus without JSON.parse/stringify: JS numbers lose uint64 precision.
  const provenance = JSON.stringify({ sdkCommit: sha, sourceSHA256: files, corpusSHA256: hash(corpus), generator: 'bench/app/export-resource-corpus.mjs', verificationOnly: true });
  await writeFile(resolve(values.out), `{"provenance":${provenance},"corpus":${corpus.trim()}}\n`);
  process.stdout.write(`${JSON.stringify({ out: resolve(values.out), sdkCommit: sha, corpusSHA256: hash(corpus) })}\n`);
} finally {
  await rm(temporary, { recursive: true });
}
