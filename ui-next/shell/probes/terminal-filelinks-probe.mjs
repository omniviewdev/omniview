// The file links in the terminal's output, as a probe of its own (terminal-probe.mjs, `PART=filelinks`; the sections are in terminal-filelinks.mjs, which has its own header): a path the host resolved is a link under the modifier,
// with the resolved path in its tooltip (files.link); the host is asked nothing without the modifier (files.modifier); a click copies the path (files.click); a path resolves against the directory of the command that printed it
// (files.directory); at most 10 candidates of the hovered line are asked about, and no other line (files.counts); a megabyte of `a:1` makes no link and the page stays responsive (files.big); nothing is asked while a program holds
// the foreground (files.foreign); the keyboard lists the files in view (files.keys); and axe (axe.files). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-filelinks-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'filelinks';
await import('./terminal-probe.mjs');
