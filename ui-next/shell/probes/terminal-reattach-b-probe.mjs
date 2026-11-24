// The second third of the reattach part of the Terminal probe (terminal-probe.mjs, `PART=reattach-b`; the sections are in terminal-reattach.mjs), as a probe of its own: a query in a replay that nobody answers (reattach.muted), the modes
// of a program restored from the replay (reattach.modes), and the size and the redraw of a full-screen program after a reload (reattach.size). The first third is terminal-reattach-probe.mjs, the last terminal-reattach-c-probe.mjs.
//
//   node ui-next/shell/probes/terminal-reattach-b-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-b';
await import('./terminal-probe.mjs');
