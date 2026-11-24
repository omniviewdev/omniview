// The page's events coming back after a gap, as a probe of its own (terminal-probe.mjs, `PART=reattach-f`; the sections are in terminal-reattach-followups.mjs): the rejoin by offset with no gap and no duplicate (reattach.rejoin), the rejoin
// when the host's ring no longer reaches back (reattach.rejoin-gap), a terminal that is not there any more (reattach.gone), the keys typed while a late replay is written (reattach.rejoin-keys) and an acknowledgement that is in flight
// when the rejoin is answered (reattach.rejoin-acks). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-reattach-f-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-f';
await import('./terminal-probe.mjs');
