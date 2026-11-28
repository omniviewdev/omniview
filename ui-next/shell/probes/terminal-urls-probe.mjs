// URLs and OSC 8 hyperlinks in the terminal's output, as a probe of its own (terminal-probe.mjs, `PART=urls`; the sections are in terminal-urls.mjs, which has its own header): a hyperlink whose text and target differ shows its target before it
// opens (urls.target), a click with the platform's modifier opens the target through the window's opener and never through `window.open` or `confirm` (urls.open), a script, a file and the host's own server are refused (urls.refuse), the
// links in view are reachable from the keyboard (urls.keys), and axe finds nothing in the tooltip or the submenu (axe.urls). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-urls-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'urls';
await import('./terminal-probe.mjs');
