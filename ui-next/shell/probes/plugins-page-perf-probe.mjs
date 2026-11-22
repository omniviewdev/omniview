// The `perf` section of the Plugins page probe (PL1) on its own, as a probe of its own so that CI runs it as a unit of its own (plugins-page-probe.mjs says why the wrapper is here): every assertion in it is a count, none a time.
process.env.SECTIONS = 'perf';
await import('../plugins-page/probes/plugins-probe.mjs');
