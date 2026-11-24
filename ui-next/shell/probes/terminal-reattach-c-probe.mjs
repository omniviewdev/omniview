// The last third of the reattach part of the Terminal probe (terminal-probe.mjs, `PART=reattach-c`; the sections are in terminal-reattach.mjs), as a probe of its own: a terminal another tab took (reattach.detached), a lease that runs out
// (reattach.lease), a saved tab whose terminal is gone (reattach.restart), a page that is going away (reattach.leave) and the numbers of the input after a reattach (reattach.seq). The first third is terminal-reattach-probe.mjs.
//
//   node ui-next/shell/probes/terminal-reattach-c-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-c';
await import('./terminal-probe.mjs');
