// The keyboard in the Ports tool and its states with nothing to show, as a probe of its own (ports-run.mjs, `PART=c`; the sections are in ports.mjs, which has its own header): the buttons of a row are ONE Tab stop (keys.tabstop), the arrows, Home and
// End move inside the row and Tab leaves it (keys.arrows), and when the row that has the keyboard goes the keyboard goes to the row that took its place, else the row before, else the tool's tab, also when the row goes under its own menu
// (keys.next); and what the tool says and offers when it holds no forward (ports.empty), while the host has not answered (ports.loading) and when the host could not be read, where Try again asks once (ports.failed), and that no button starts a
// forward anywhere. Everything is in ports-run.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/ports-c-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of ports-run.mjs applies)
process.env.PART = 'c';
await import('./ports-run.mjs');
