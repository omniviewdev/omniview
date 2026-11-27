// Where a terminal opens and what it is called, as a probe of its own (terminal-probe.mjs, `PART=where`; the sections are in terminal-where.mjs, which has its own header): the menu beside the `+` that lists the shells (where.menu-rows,
// where.menu-keys, where.menu-start), the title a program sets on the tab, bounded, and the rename in place (where.title, where.title-bound, where.rename), the lane of an ended terminal that offers Restart (where.restart-offer, where.restart),
// and axe (axe.where). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-where-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'where';
await import('./terminal-probe.mjs');
