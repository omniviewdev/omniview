// The panes of the Terminal tool, as a probe of its own (terminal-probe.mjs, `PART=panes`; the sections are in terminal-panes.mjs, which has its own header): Split terminal and the layout it makes, the sash's drag and keys, the minimum of 80 px,
// a window made narrower, a split refused when no pane fits, the WebGL contexts of three panes hidden and shown ten times, and axe. Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-panes-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'panes';
await import('./terminal-probe.mjs');
