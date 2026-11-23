// N27 proof tool (scratch): the plan of a both-ways run: only the units of controls, each counted twice (planted and with the assertion off), packed under a limit of its own; writes the same outputs as `probe-shards.mjs plan`.
import { appendFileSync } from 'node:fs';
import { pack } from './probe-pack.mjs';
import * as engine from './probe-shards.mjs';

const LIMIT = Number(process.env.BOTH_WAYS_LIMIT ?? 560);
const loaded = await engine.loadUnits(engine.REPO_ROOT);
if (loaded.problems.length > 0) {
  for (const problem of loaded.problems) console.error(problem.message);
  process.exit(1);
}
const units = loaded.units.filter((unit) => unit.controls !== undefined);
const packed = pack(units.map((unit) => ({ id: unit.id, seconds: unit.seconds * 2 })), LIMIT);
const byId = new Map(units.map((unit) => [unit.id, unit]));
const matrix = { include: packed.map((shard, index) => ({ shard: index + 1, units: shard.units.map((entry) => entry.id).join(','), seconds: shard.seconds, dist: shard.units.some((entry) => engine.readsDist(byId.get(entry.id))) })) };
const controls = units.reduce((sum, unit) => sum + unit.controls.length, 0);
const text = `both-ways plan: ${units.length} control units, ${controls} controls, ${matrix.include.length} shards of at most ${LIMIT} s (each unit counted twice)\n${matrix.include.map((shard) => `  shard ${shard.shard}: ${shard.seconds} s: ${shard.units}`).join('\n')}\n`;
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nshards=${matrix.include.length}\n`);
