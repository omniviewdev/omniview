// The find bar of the terminal over the long output, as a probe of its own (terminal-probe.mjs, `PART=find-b`; the sections are in terminal-find.mjs, which has its own header): after a reload of the page the scrollback the host replays is
// searched (find.replay, against the probe's own host, terminal-host.mjs); a bar that is closed is no node and no commit, before it was ever opened and after it was opened and closed (find.idle, in the development build, whose React Profiler
// counts commits); a find with more matches than it highlights says `20,000+` and holds no more highlights than that (find.cap); and axe finds nothing in the open bar (axe.find). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-find-b-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'find-b';
await import('./terminal-probe.mjs');
