// The first third of the reattach part of the Terminal probe (terminal-probe.mjs, `PART=reattach-a`; the sections are in terminal-reattach.mjs) as a probe of its own, so that CI runs it as a unit of its own and no unit passes half a shard:
// the page key made once and kept in the window's state (reattach.key), the saved session that brings the same tabs back (reattach.restore), and a reload during a numbered flood that joins with no gap and no duplicate (reattach.exact).
// The other two thirds are terminal-reattach-b-probe.mjs and terminal-reattach-c-probe.mjs. Everything is in terminal-probe.mjs (the engines and viewports, the controls' table, the report, the shared build); this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-reattach-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-a';
await import('./terminal-probe.mjs');
