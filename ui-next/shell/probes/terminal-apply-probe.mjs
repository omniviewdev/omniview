// What the person's settings do to a terminal that is open, as a probe of its own (terminal-probe.mjs, `PART=apply`; the sections are in terminal-apply.mjs, which has its own header): the blink of the cursor is a timer only with the
// focus and the setting (apply.blink), a smaller scrollback trims and a larger one keeps (apply.scrollback), Option as Meta on a Mac follows the setting and the keyboard's layout (apply.meta-*), and the bell fades a screen that is shown,
// marks the tab of one that is not, and is silent (apply.bell-*). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-apply-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'apply';
await import('./terminal-probe.mjs');
