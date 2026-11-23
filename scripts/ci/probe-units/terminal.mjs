// The Terminal tool (T1): the real host's window with no plugin and a synthetic shell behind the real exec feed (ui-next/shell/probes/terminal-fixture.tsx), in a production build of the fixture (the measurements) and a
// development one (React's Profiler counts commits there), against the mock's own terminal body (ui-next/shell/probes/mock-terminal.json, measured by mock-terminal-measure.mjs) within 1 px: the rectangles, the words, the keys
// (Escape and Tab stay in the shell, F6 leaves, the copy and paste chords), the close question, the resize messages, the emulator that costs nothing until the first terminal, what a hidden panel and an idle terminal cost (no
// frame, no write, no timer), no React commit for an output chunk, a 16 MB flood (every byte parsed, frames at 60 Hz or near, no long task), the latency of a key, 1,000,000 lines kept to the cap, what is painted (no frame around
// the screen, the caret, the scrollbar) read from screenshots, and axe; in WebKit and Chromium at 1440 x 900 and 1280 x 800. It builds its own fixtures, so it does not read PROBE_DIST.
//
// The seconds are the runner's, from the first CI run of this probe (head 7f817788: the probe 150 s, its controls 98, 119 and 69 s; every assertion and every control passed there). They were first listed at the laptop's times 2.5
// (370, 250, 300 and 175 s), and the runner turned out about as fast as the laptop for this probe, not slower. After the review of #660 the probe has three seconds more (the scrollbar must go away again) and the body's controls one more
// (`scrollbar-stuck`, about 18 s): 160 and 120 s are the laptop's 146 to 153 s and about 116 s, until the runner's own numbers replace them. The probe's bounds that are times held on the runner with room: a key reaches the process in 50 ms
// or less idle and 100 ms under a flood (the laptop reads 1 to 6 ms under a flood that really runs; the first numbers, 1 ms and 0.4 ms, were taken with no flood running), a task is under 120 ms, and the flood's frames are a COUNT, not a
// percentile of milliseconds (a tenth at most may take longer than two frames; the laptop has none to one in 300). The runner's own flood and latency numbers are in docs/ui-next/status/T1.md section 8 once read from its log.

export const units = [
  {
    id: 'terminal',
    name: 'Probe the Terminal tool against the pinned mock reference',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-probe.json' },
    seconds: 170,
  },

  // The negative controls of the terminal probe, each perturbs one thing in the page after it loaded (or in the fixture) and passes only when the probe sees it, on the assertion that must (Chromium, 1440 x 900; the flood's
  // in WebKit, the heap's in Chromium); with that assertion dropped (ASSERTION_OFF) it is not detected. The body's nine: a lane border in red, buttons of 32 px, the screen's outline back, the emulator's scrollbar forced
  // visible, the same scrollbar kept visible after the pointer left it, a listener that swallows F6, one that blurs on Escape, a dialog that is not modal, a settle of 100 ms that is 0.
  {
    id: 'terminal-controls-body',
    name: 'Probe that the terminal probe sees a terminal body that is wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['lane-border', 'button-size', 'ring-back', 'scrollbar-block', 'scrollbar-stuck', 'f6-trap', 'escape-leaves', 'modal-off', 'resize-chatty'],
    seconds: 120,
  },

  // The terminal that does work it should not: a frame asked for while the panel is hidden, an interval left running, a component that renders for each chunk, frames that come 45 ms late, a key handler that takes 80 ms.
  {
    id: 'terminal-controls-work',
    name: 'Probe that the terminal probe sees a terminal that works when it should not',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['hidden-frames', 'idle-timer', 'chunk-commit', 'flood-janky', 'echo-slow'],
    seconds: 120,
  },

  // The terminal that costs what it should not: the emulator's chunk imported before the first terminal, four times the scrollback, a page that holds every event it was sent.
  {
    id: 'terminal-controls-cost',
    name: 'Probe that the terminal probe sees a terminal that costs too much',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['lazy-load', 'big-scrollback', 'leaky-heap'],
    seconds: 70,
  },

  // The screen reader switch (docs/ui-next/status/T1.md section 16), each in Chromium: an emulator that is never put in the mode the window says it is in, one that is put in it and never taken out, a description that keeps the words of
  // the mode off, an announcement made twice, an accessibility violation that exists only while the mode is on, a frame loop while the panel is hidden with the mode on, an interval while the terminal is idle with it on.
  {
    id: 'terminal-controls-reader',
    name: 'Probe that the terminal probe sees a screen reader mode that is wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['reader-claims', 'reader-stuck', 'reader-words-stale', 'reader-announce-twice', 'reader-axe', 'reader-hidden-frames', 'reader-idle-timer'],
    seconds: 65,
  },
];
