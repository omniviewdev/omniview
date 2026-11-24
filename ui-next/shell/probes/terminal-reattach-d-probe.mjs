// The saved panel of the reattach part of the Terminal probe (terminal-probe.mjs, `PART=reattach-d`; the section is in terminal-reattach-followups.mjs) as a probe of its own, so that CI runs it as a unit of its own and no unit passes half
// a shard: a saved open panel comes back open with its tool, its session and its height after a reload, and a saved closed panel stays closed (restore.open). Everything is in terminal-probe.mjs (the engines and viewports, the controls' table,
// the report, the shared build); this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-reattach-d-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-d';
await import('./terminal-probe.mjs');
