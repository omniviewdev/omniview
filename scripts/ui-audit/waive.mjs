#!/usr/bin/env node
// Human-only escape hatch for a stuck UI audit gate.
// Usage: node scripts/ui-audit/waive.mjs <receiptDir> <snapshot> "<reason>"
// Binds to one snapshot: any later edit produces a new snapshot and requires a real audit again.
// Orchestration guard, not a sandbox: a same-user process with a pty can still run it.
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const [receiptDir, snapshot, ...rest] = process.argv.slice(2);
const reason = rest.join(' ').trim();
const fail = message => { console.error(message); process.exit(2); };

if (!receiptDir || !/^[a-f0-9]{64}$/.test(snapshot ?? '') || !reason || reason === '<reason>') {
  fail('Usage: node scripts/ui-audit/waive.mjs <receiptDir> <64-hex snapshot> "<reason>"');
}
if (!process.stdin.isTTY || !process.stdout.isTTY) fail('Waiving requires an interactive terminal. Run this yourself; an agent must not waive its own audit.');
try { await stat(join(receiptDir, 'baseline.json')); } catch { fail(`Not a UI audit receipt directory: ${receiptDir}`); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`Waive UI audit for snapshot ${snapshot}?\nReason: ${reason}\nType the first 8 characters of the snapshot to confirm: `)).trim();
rl.close();
if (answer !== snapshot.slice(0, 8)) fail('Confirmation mismatch. Nothing written.');

const waiver = { version: 1, snapshot, reason, waivedAt: new Date().toISOString() };
const body = JSON.stringify(waiver, null, 2);
await writeFile(join(receiptDir, `waiver-${Date.now()}.json`), body);
await writeFile(join(receiptDir, 'waiver.json'), body);
console.log(`Waived snapshot ${snapshot}. Any further relevant edit requires a real audit.`);
