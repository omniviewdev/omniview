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
    seconds: 130,
  },

  // What flows and what it costs: a hidden panel that goes on taking in what its shell writes (2 MB and 20 MB), an idle terminal, a chunk of output that renders nothing, a 16 MB flood, the latency of a key, 1,000,000 lines kept to the
  // cap, the input as numbered calls. WebKit and Chromium at 1440 x 900.
  {
    id: 'terminal-data',
    name: 'Probe what the Terminal tool takes in and what it costs',
    script: 'ui-next/shell/probes/terminal-data-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-data-probe.json' },
    seconds: 130,
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
    seconds: 110,
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
    seconds: 95,
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
    seconds: 95,
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
    seconds: 85,
  },

  // The input and the size (docs/ui-next/terminal-channel-protocol.md section 4, T2a), each in Chromium: a host that takes a size frame and keeps its size, a page that sends what is typed one frame at a time, each after the one before was applied, a size told before
  // the GPU renderer is in place, a host that opens the pty one column wider than it was asked to, a close question that leaves the keyboard on the pointer-only close button, and a Delete on the tab that never asks the question. The controls
  // that were about numbered calls (a host that applies them in the order they arrive, calls numbered with a number missing, an old call made as well) are gone with the numbers: the order is the stream's.
  {
    id: 'terminal-controls-input',
    name: 'Probe that the terminal probe sees input that is sent wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['resize-dropped', 'input-serial', 'early-size', 'size-off', 'focus-close-button', 'focus-delete-swallowed'],
    plants: 'page',
    seconds: 60,
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
    seconds: 50,
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
    seconds: 45,
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
    seconds: 40,
  },

  // A terminal survives a reload of the page (the terminal channel: a capability and one stream for each terminal), the probe's own far end holding the host for the whole browser context (terminal-host.mjs, terminal-serve.mjs, terminal-reattach.mjs). Three units of the probe, which no unit passes half a shard
  // for (216 s): the capability slot, the saved session and a reload under a flood; a query in a replay, the modes of a program and the size after a reload; and a terminal another tab took, a lease, a saved tab whose terminal is gone, the
  // page that is going away, a shell that ended while no page held it, and axe on a terminal that another tab took and on one that is reattaching. WebKit and Chromium at both viewports (axe at the first). The seconds are the laptop's at load under 10 (33 s, 38 s and 101 s, builds shared) times about 2.5, until a runner has measured them.
  {
    id: 'terminal-reattach',
    name: 'Probe that a terminal survives a reload of the page: the key, the session and an exact join',
    script: 'ui-next/shell/probes/terminal-reattach-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-probe.json' },
    seconds: 45,
  },
  {
    id: 'terminal-reattach-b',
    name: 'Probe that a terminal survives a reload of the page: the replay, its modes and its size',
    script: 'ui-next/shell/probes/terminal-reattach-b-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-b-probe.json' },
    seconds: 45,
  },
  {
    id: 'terminal-reattach-c',
    name: 'Probe that a terminal survives a reload of the page: who holds it, how it ends and its input',
    script: 'ui-next/shell/probes/terminal-reattach-c-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-c-probe.json' },
    seconds: 115,
  },

  // The reattach assertions' faults, each in Chromium at one viewport, in four units by what they cost: the page puts its capability in the address, the window's state never keeps the capability slot, nor the session, and a replay with a gap
  // (the first); a page that never credits the replay, a reply to a query of the replay that reaches the shell, modes the host lost and a resize the pty ignores (the second); a takeover nobody is told of and a lease that never runs out (the third); and a host that lists a terminal it no longer has, a kept end it lists
  // as a terminal that runs and a page that never says it is leaving (the fourth). The controls of the events lane's numbers (a late duplicate at the offset the page expects, a number of the input lost on the way, a takeover named with its own number) are gone with the numbers.
  {
    id: 'terminal-controls-reattach',
    name: 'Probe that the reattach probe sees a key and a session that are lost',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['cap-in-url', 'cap-forgotten', 'no-session', 'replay-gap'],
    plants: 'page',
    seconds: 40,
  },
  {
    id: 'terminal-controls-reattach-b',
    name: 'Probe that the reattach probe sees a join, a replay and a size that are wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['replay-unacked', 'unmuted-reply', 'modes-lost', 'resize-ignored'],
    plants: 'page',
    seconds: 50,
  },
  {
    id: 'terminal-controls-reattach-c',
    name: 'Probe that the reattach probe sees a takeover and a lease that are wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['no-taken-over', 'lease-never'],
    plants: 'page',
    seconds: 55,
  },
  {
    id: 'terminal-controls-reattach-d',
    name: 'Probe that the reattach probe sees a list, a tombstone, a leave and an input that are wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['list-ghost', 'tombstone-adopted', 'detached-axe', 'leave-lost'],
    plants: 'page',
    seconds: 20,
  },

  // T2d: the panel's saved open flag, taking a terminal back (and the guard of its button, and what a tab that was offline learns when it asks again) and the stream coming back after a drop (the reconnect by offset, the reconnect
  // past the ring, the keys typed while a late replay is written, the acknowledgement in flight, a terminal that is gone), each a probe of its own (the sections are in terminal-reattach-followups.mjs, the far end is terminal-host.mjs).
  // WebKit and Chromium at both viewports. The seconds are the laptop's measure times 1.3 (the runner measured about the laptop for the reattach units); the laptop's measure of the probes is 10, 33 and 45 s: the sections wait on what the
  // page shows and on counters, with no clock, so they take 1 to 5 s each at each of the four sizes.
  {
    id: 'terminal-reattach-d',
    name: 'Probe that the panel comes back as it was left after a reload: open or closed, its tool, its session and its height',
    script: 'ui-next/shell/probes/terminal-reattach-d-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-d-probe.json' },
    seconds: 13,
  },
  {
    id: 'terminal-reattach-e',
    name: 'Probe that a terminal whose taker has gone can be taken back, with a button and one attach, that a stale button asks the host first, and what a tab whose events were down learns when they are back',
    script: 'ui-next/shell/probes/terminal-reattach-e-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-e-probe.json' },
    seconds: 43,
  },
  {
    id: 'terminal-reattach-f',
    name: 'Probe what the page does when its events come back after a gap: the rejoin by offset, the rejoin past the ring, the keys typed while a late replay is written, an acknowledgement in flight and a terminal that is gone',
    script: 'ui-next/shell/probes/terminal-reattach-f-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/terminal-reattach-f-probe.json' },
    seconds: 59,
  },

  // The faults of the follow-ups, each in Chromium at one viewport, in three units by what they cost: a saved panel that comes back the other way (the first, 13 s on the laptop); a take-back that is not offered when the taker has gone, one
  // that attaches twice, a violation in the lane with its button, a take-back that is not asked of the host, and a tab that never asks it again (the second, 32 s); and a reconnect that starts from the first byte, one given
  // nothing of what was missed, one that never credits the replay, a gap that the host hides, a terminal that is gone and answered with a plain close, a screen that drops the keys typed while a replay is written, an engine that gives the
  // emulator's answers as keys and a stale acknowledgement that the host takes after the attach (the third, 69 s).
  {
    id: 'terminal-controls-reattach-e',
    name: 'Probe that the reattach probe sees a panel that does not come back as it was left',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['restore-forgets-open', 'restore-forgets-closed'],
    plants: 'page',
    seconds: 17,
  },
  {
    id: 'terminal-controls-reattach-f',
    name: 'Probe that the reattach probe sees a take-back that is wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['taker-gone-ignored', 'take-back-twice', 'free-axe', 'takeback-unguarded', 'refresh-skipped'],
    plants: 'page',
    seconds: 42,
  },
  {
    id: 'terminal-controls-reattach-g',
    name: 'Probe that the reattach probe sees a rejoin that is wrong',
    script: 'ui-next/shell/probes/terminal-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['rejoin-from-zero', 'reconnect-drops-missed', 'reconnect-replay-unacked', 'gap-hidden', 'gone-keeps-attaching', 'keys-dropped', 'replies-as-keys', 'ack-stale-restore'],
    plants: 'page',
    seconds: 90,
  },
];
