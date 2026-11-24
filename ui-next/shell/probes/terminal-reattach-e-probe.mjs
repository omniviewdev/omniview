// Taking a terminal back, as a probe of its own (terminal-probe.mjs, `PART=reattach-e`; the sections are in terminal-reattach-followups.mjs): a tab that lost its terminal to another tab, whose taker has gone, has a button that takes it back
// and makes one attach, and has none while a taker lives (reattach.takeback); axe finds nothing in the lane with the button (reattach.axe-free); a button that is stale (a third tab holds the terminal and the host said nothing) asks the host
// and attaches nothing (reattach.takeback-guard); a tab whose events were down when the taker went shows the button once they are back, and none while the taker holds the terminal (reattach.takeback-offline). Everything is in
// terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-reattach-e-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-e';
await import('./terminal-probe.mjs');
