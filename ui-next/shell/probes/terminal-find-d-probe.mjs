// The links in the terminal's output, as a probe of its own (terminal-probe.mjs, `PART=find-d`; the sections are in terminal-find.mjs, which has its own header): the pointer on a web address says how to follow it for the platform
// (`Follow link (cmd + click)` on a Mac, `(ctrl + click)` elsewhere) and the words are no node when it leaves (links.tooltip); a plain click follows nothing, a click with the platform's modifier opens the address once through the window's
// own way, a script, another scheme and a name open nothing, and a window with no way to open an address draws no link and no tooltip (links.activate); and axe finds nothing in the tooltip (axe.tooltip). Everything is in terminal-probe.mjs; this
// file says only which part runs.
//
//   node ui-next/shell/probes/terminal-find-d-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'find-d';
await import('./terminal-probe.mjs');
