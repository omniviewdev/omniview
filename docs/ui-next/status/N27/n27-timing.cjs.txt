// N27 measurement only (a scratch branch, never merged): wraps child_process.execFileSync so that every build a probe starts prints how long it took.
// NODE_OPTIONS=--require <this file> reaches every probe process through the shard runner.
const childProcess = require('node:child_process');
const real = childProcess.execFileSync;
childProcess.execFileSync = function execFileSync(file, args, options) {
  const list = Array.isArray(args) ? args : [];
  const text = [file, ...list].map(String).join(' ');
  const build = /build-fixture\.mjs|settings-build\.mjs|\bvite\b|--input-type=module|run build/.test(text);
  if (!build) return real.apply(this, arguments);
  const started = process.hrtime.bigint();
  try {
    return real.apply(this, arguments);
  } finally {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const tail = list.slice(-2).map((item) => String(item).slice(-60)).join(' ');
    console.log(`[n27-build] ${seconds.toFixed(2)} s: ${String(file).slice(-30)} ${String(list[0] ?? '').slice(0, 40)} ... ${tail}`);
  }
};
require('node:module').syncBuiltinESMExports();
