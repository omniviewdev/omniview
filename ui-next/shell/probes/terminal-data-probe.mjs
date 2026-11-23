// The data half of the Terminal probe (terminal-probe.mjs, `PART=data`) on its own, as a probe of its own so that CI runs it as a unit of its own: the whole probe took 238 s on the runner and no unit may pass half a shard (216 s). It holds the
// sections of what flows and what it costs: a hidden panel that takes in what the shell writes, an idle terminal, the commits of an output chunk, a 16 MB flood, the latency of a key, 1,000,000 lines kept to the cap, and the input as numbered
// calls. The other half is `PART=view`, which the unit of terminal-probe.mjs runs (the sections of the page: what a person sees and does). The probe refuses to start when a section is in neither part or in both, so that no assertion is left out
// by the split. Everything is in terminal-probe.mjs (the engines and viewports, the controls' table, the report, the shared build); this file says only which part runs. The negative controls of both halves run through terminal-probe.mjs.
//
//   node ui-next/shell/probes/terminal-data-probe.mjs     WebKit and Chromium at 1440 x 900 (and 1280 x 800, where a section keeps to the first) (the environment of terminal-probe.mjs applies)
process.env.PART = 'data';
await import('./terminal-probe.mjs');
