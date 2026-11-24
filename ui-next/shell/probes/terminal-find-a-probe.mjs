// The find bar of the terminal, as a probe of its own (terminal-probe.mjs, `PART=find-a`; the sections are in terminal-find.mjs, which has its own header): the chord opens it with the field focused over a screen whose cells do not
// change, and it is where and as large as the mock's (find.open); its count against the probe's own scan of the buffer, the steps, the three switches, a pattern that does not parse and a word that is not there (find.count); Enter, Shift+Enter,
// F3 and Shift+F3, Escape and Tab (find.keys); and the code that finds is requested once, by the first find (find.lazy). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-find-a-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'find-a';
await import('./terminal-probe.mjs');
