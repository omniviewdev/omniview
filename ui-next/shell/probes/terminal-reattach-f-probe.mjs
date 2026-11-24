// The page's stream to a terminal lost and coming back, as a probe of its own (terminal-probe.mjs, `PART=reattach-f`; the sections are in terminal-reattach-followups.mjs): the reconnect from the offset the page has, with no gap and no duplicate (reattach.reconnect), the reconnect
// when the host's ring no longer reaches back (reattach.reconnect-gap), a terminal that is not there any more (reattach.gone), the keys typed while a late replay is written (reattach.reconnect-keys) and an acknowledgement of the lost stream that reaches
// the host after the new attach (reattach.reconnect-acks). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-reattach-f-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'reattach-f';
await import('./terminal-probe.mjs');
