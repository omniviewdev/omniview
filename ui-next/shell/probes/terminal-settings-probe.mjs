// The person's terminal settings, as a probe of its own (terminal-probe.mjs, `PART=settings`; the sections are in terminal-settings.mjs, which has its own header): a change reaches a terminal that is open in one event and
// with no new emulator and no scrollback lost (settings.live), and a font that is not loaded when it is chosen is loaded before the emulator measures its cell, when the terminal is made and while it is open (settings.font-open,
// settings.font-live). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-settings-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'settings';
await import('./terminal-probe.mjs');
