// The command gutter of the terminal, as a probe of its own (terminal-probe.mjs, `PART=gutter`; the sections are in terminal-gutter.mjs, which has its own header): a mark for each command, beside its row and over no cell of the output,
// hidden by the alternate screen (gutter.marks); the words of the pointer on a mark (gutter.hover); the keys that jump between commands and the copy of a command's output (gutter.keys); the gutter after a reload (gutter.reload); and axe
// (axe.gutter). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-gutter-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'gutter';
await import('./terminal-probe.mjs');
