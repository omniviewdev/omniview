// The Terminal tool (T1, T2a): the real host's window with no plugin and a synthetic shell behind the real exec feed (ui-next/shell/probes/terminal-fixture.tsx, which invents only the far end: the host's exec bindings, with the host's
// credit flow control, its ordered input calls, its typed end, its busy fact and its typed refusals), in a production build of the fixture (the measurements) and a development one (React's Profiler counts commits there), against the
// mock's own terminal body (ui-next/shell/probes/mock-terminal.json, measured by mock-terminal-measure.mjs) within 1 px.
//
// THE PROBE IS TWO UNITS. The whole probe took 238 s on the runner (head 8c54c3a7: the laptop's 206 s), and no unit may pass half a shard (216 s), so it runs in two parts that cover every section once (`PART=` in terminal-probe.mjs, which
// refuses to start when a section is in neither part or in both): `terminal` is PART=view, the sections of the page (the rectangles, the words, the tab named by the shell, how a process ended, a refused start, the keys, the close
// question and where the keyboard goes after a no, the resize messages, the size the process starts at, the emulator that costs nothing until the first terminal, what is painted, axe, the screen reader mode and what it costs), and
// `terminal-data` is PART=data, through the wrapper terminal-data-probe.mjs (a probe runs once, so the second half is a script of its own): a hidden panel that takes in what the shell writes, an idle terminal, the commits of an output
// chunk, a 16 MB flood, the latency of a key, 1,000,000 lines kept to the cap, and the input as numbered calls. Both build the fixture through the shard's shared BUILD_CACHE (the first process of a shard builds, the others read), as every
// negative control does: the build is given an environment without the control, and every control plants its fault in the loaded page or in what the fixture reads of its address.
//
// THE SECONDS ARE THE RUNNER'S. Units that did not change are listed at ceil5(ceil5(real) x 1.15) of the runner's seconds in head 8c54c3a7 (body 156, reader 90, facts 81); the two halves of the probe and the units of controls that
// changed are the laptop's seconds, builds included, times 1.25 (the runner was 1.15 times slower for the probe and 1.24 times for the work controls) and 15 percent: the probe 105 and 106 s of sections with a build each,
// the controls 2 to 17 s each. The probe's bounds that are times are held on the runner with room: a key reaches the process in 50 ms or less idle and 100 ms under a flood (the laptop reads 1 to 6 ms under a flood that really runs),
// a task is under 120 ms, and the flood's frames are a COUNT, not a percentile of milliseconds (a tenth at most may take longer than two frames; the laptop has none to one in 300). What a hidden panel costs is bounded by counts
// and by milliseconds with at least 3 times the laptop's room (docs/ui-next/status/T2a.md has the numbers). The first CI run of the final head measured: terminal 131, terminal-data 121, body 97, close 46, cost 66, facts 26, hidden 76,
// input 43, reader 43, work 73 s, all under what is listed here; the numbers stay conservative on purpose, because the same unit has measured 1.6 to 3 times slower on another run (reader 43 and 90, facts 26 and 81, body 97 and 156)
// and a one-sample proposal of probe-seconds.mjs would fail the drift gate on a slow runner; `terminal` is 160 (the view half: 131 on the runner, 106 on the laptop).

export const units = [
  {
    id: 'terminal',
    name: 'Probe the Terminal tool against the pinned mock reference',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40', PART: 'view', REPORT: '$RUNNER_TEMP/terminal-probe.json' },
    seconds: 160,
  },

  // What flows and what it costs: a hidden panel that goes on taking in what its shell writes (2 MB and 20 MB), an idle terminal, a chunk of output that renders nothing, a 16 MB flood, the latency of a key, 1,000,000 lines kept to the
  // cap, the input as numbered calls. WebKit and Chromium at 1440 x 900.
  {
    id: 'terminal-data',
    name: 'Probe what the Terminal tool takes in and what it costs',
    script: 'ui-next/shell/probes/terminal-data-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-data-probe.json' },
    seconds: 160,
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
    plants: 'page',
    seconds: 185,
  },

  // The terminal that does work it should not: an interval left running, a component that renders for each chunk, frames that come 45 ms late, a sample of frames that stops before the flood, a key handler that takes 80 ms. The five that tell a hidden
  // panel's work, and the four of the close question, are units of their own since the first runner measure of the work controls (227 s for the nine, head 8c54c3a7).
  {
    id: 'terminal-controls-work',
    name: 'Probe that the terminal probe sees a terminal that works when it should not',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['idle-timer', 'chunk-commit', 'flood-janky', 'flood-no-sample', 'echo-slow'],
    plants: 'page',
    seconds: 130,
  },

  // The terminal that costs what it should not: the emulator's chunk imported before the first terminal, four times the scrollback, a page that holds every event it was sent, every parsed write acknowledged twice, and the memory measured of a flood
  // that the page did not take in.
  {
    id: 'terminal-controls-cost',
    name: 'Probe that the terminal probe sees a terminal that costs too much',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['lazy-load', 'big-scrollback', 'leaky-heap', 'memory-undrained', 'ack-double'],
    plants: 'page',
    seconds: 115,
  },

  // A hidden panel (docs/ui-next/status/T2a.md: it goes on reading, parsing and acknowledging, in frames of a smaller share, and draws nothing of the page's), each in Chromium: the create call answers after the shell's first output (the first
  // acknowledgement comes late, with something owed), the output is credited as it is delivered and not when it is parsed, the credit that comes while the host is paused is lost (it never reads again), two slices of the output never reach
  // the emulator and are acknowledged all the same, the fifth slice comes after the sixth, three more loops of animation frames than the bytes need, one callback that holds the main thread for 150 ms, a frame loop and an interval at rest, a page that
  // changes its own document for every event it is given.
  {
    id: 'terminal-controls-hidden',
    name: 'Probe that the terminal probe sees a hidden terminal that stalls its shell, loses output or works too much',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['flow-late', 'ack-on-receipt', 'ack-lost', 'drop-held', 'swap-held', 'hidden-frames', 'hidden-burn', 'hidden-rest', 'draw-hidden'],
    plants: 'page',
    seconds: 160,
  },

  // The input and the size (docs/ui-next/status/T1-go.md 2.4, T2a), each in Chromium: a host that applies the calls in the order they arrive, a host that refuses the size call, a page that sends what is typed one call at a time, calls numbered with a
  // number missing, an old call made as well, a size told before the GPU renderer is in place, a host that opens the pty one column wider than it was asked to, a close question that leaves the keyboard on the pointer-only close button, and a Delete on
  // the tab that never asks the question.
  {
    id: 'terminal-controls-input',
    name: 'Probe that the terminal probe sees input that is sent wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['arrival-order', 'resize-refused', 'input-serial', 'seq-gap', 'legacy-write', 'early-size', 'size-off', 'focus-close-button', 'focus-delete-swallowed'],
    plants: 'page',
    seconds: 95,
  },

  // The question a close asks when what the host says is wrong (docs/ui-next/status/T1-go.md 2.3), in Chromium: `IsBusy` says a program named sleep runs while the shell is at its prompt (a question that must not be asked), says one
  // runs and does not name it, a host that cannot say is told idle, and the page's wait of 1.5 s for an answer never ends.
  {
    id: 'terminal-controls-close',
    name: 'Probe that the terminal probe sees a close that asks wrongly',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['busy-always', 'busy-nameless', 'unknown-idle', 'ask-never'],
    plants: 'page',
    seconds: 90,
  },

  // The screen reader switch (docs/ui-next/status/T1.md section 16), each in Chromium: an emulator that is never put in the mode the window says it is in, one that is put in it and never taken out, a description that keeps the words of
  // the mode off, an announcement made twice, an accessibility violation that exists only while the mode is on, a frame loop while the hidden panel is at rest with the mode on, an interval while the terminal is idle with it on.
  {
    id: 'terminal-controls-reader',
    name: 'Probe that the terminal probe sees a screen reader mode that is wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['reader-claims', 'reader-stuck', 'reader-words-stale', 'reader-announce-twice', 'reader-axe', 'reader-hidden-frames', 'reader-idle-timer'],
    plants: 'page',
    seconds: 110,
  },

  // What the host says of the shell wrong (T2a), each in Chromium: a create answer with no shell name, an end with no code, no signal, no one who closed it, a refusal to find a shell with its words and no code, a plain start failure
  // with the code of a missing shell, and a violation in the lane of a terminal that could not start.
  {
    id: 'terminal-controls-facts',
    name: 'Probe that the terminal probe sees a shell the host did not describe',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['no-shell-name', 'exit-code-lost', 'signal-lost', 'closed-lost', 'code-less', 'start-typed', 'axe-failed'],
    plants: 'page',
    seconds: 100,
  },
];
