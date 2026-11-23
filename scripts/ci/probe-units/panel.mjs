// The bottom panel (P1a): the region, the splitter, the tool strip, the session tabs, the session card and the status bar's toggle against the pinned mock reference (ui-next/shell/probes/mock-panel.json, measured from the
// mock's own panel by mock-panel-measure.mjs), what opening and resizing the panel move (the frame's height, nothing else), the paint of its parts, the keyboard path and the splitter's keys with real key presses, axe, what a
// drag costs (no write at the document root, no commit while the pointer moves), a plugin's tool that registers late, and a session body that keeps running while it is hidden, and (A21) the sessions of the host's Logs tool
// that their plugin's unload kept (the tab stays in its place, ended or as it was, its body mounted and counting no more, the card's link and Open button unavailable while the plugin is off and working when it returns, a
// new press a twin beside it, Delete closing it), and (A22) the scope of a session tab: drawn only when two open sessions of one title differ in scope, against the mock's own twin tabs within 1 px (mock-panel.json,
// scenario `twins`) and on the shell's markup, and axe on the open Logs tool with two scoped twin tabs, at 1440 x 900 and 1280 x 800. It builds its own fixtures, so it does not read PROBE_DIST.
//
// The negative controls (14, 480 s in one unit until N25) are three units, split by what the control perturbs and not by what it asserts; no control was changed. Each perturbs one measured value in the page and
// passes only when the probe sees it.

export const units = [
  {
    id: 'panel',
    name: 'Probe the bottom panel against the pinned mock reference',
    script: 'ui-next/shell/probes/panel-probe.mjs',
    env: { REPORT: '$RUNNER_TEMP/panel-probe.json' },
    seconds: 300,
  },

  // The frame of the panel: the region's height, the gap between a session's glyph and its name, the toggle's place, a tool tab's padding, the sidebar's place when the panel opens, and a write at the document root during a
  // drag. What they perturb is the region, the toggle in the status bar and the frame around them.
  {
    id: 'panel-controls-frame',
    name: 'Probe that the panel probe sees a panel that is wrong (the frame)',
    script: 'ui-next/shell/probes/panel-probe.mjs',
    controls: ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write'],
    plants: 'page',
    seconds: 160,
  },

  // The sessions their plugin's unload kept (A21): the tab of the held session is not drawn, nor is the tab of the one that had ended on its own, a tab moves, the Open button can be pressed while the plugin is off. They run
  // on the host fixture, so the plugin host and the sessions' model are what they perturb.
  {
    id: 'panel-controls-held',
    name: 'Probe that the panel probe sees a panel that is wrong (the sessions a plugin kept)',
    script: 'ui-next/shell/probes/panel-probe.mjs',
    controls: ['held-hidden', 'held-done-hidden', 'held-moved', 'held-enabled'],
    plants: 'page',
    seconds: 125,
  },

  // The scope of a session tab (A22): the twins' scope part is 3 px off the mock's, a tab with no twin draws a scope, the tab left when its twin closes still draws one, the name of a scoped tab leaves its scope out.
  {
    id: 'panel-controls-twins',
    name: 'Probe that the panel probe sees a panel that is wrong (the scope of a tab)',
    script: 'ui-next/shell/probes/panel-probe.mjs',
    controls: ['twin-moved', 'twin-lone-scope', 'twin-scope-kept', 'scope-name', 'late-early'],
    plants: 'page',
    seconds: 80,
  },
];
