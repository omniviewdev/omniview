// The units of the seam check (N29, scripts/ci/seam-shards.mjs): what ui-next/plugins/e2e/seam.check.mjs does, in pieces that a job of one engine can take, each with the `seconds` it takes on the runner.
//
// `phases: [...]` is one run of the check that does only those phases (`SEAM_PHASES=<id>,<id>`, in the check's order, on a host of their own; `PHASE_IDS` in the check names them all). Its seconds are the phases' own, as the check prints
// them (`SEAM-PHASE <engine> <id> <seconds>`); the start of the host the run begins with (about 15 s) is not in them, and the plan adds it to each shard that has a phase unit.
// `runs: [...]` is some negative controls, one `SEAM_CONTROL=<run>` after the other. A run is one control for the plain ones and every control of a table for the scenarios that have one (the check's `SEAM_LIST=1` prints which): the
// settings controls are one run each, because `SEAM_CONTROL=settings` does not detect `settings-reach` (each control does alone). Its seconds are the runs' added up, a run's start included.
//
// Every phase and every run of the check is in exactly one unit (`node scripts/ci/seam-shards.mjs check` fails, naming it, for one that is in none, and the job `Seam check` fails for one that did not run), so a scenario or a
// control added to the check is added here: a phase to a unit with `phases`, a control to the unit of its scenario, a table of controls of its own as a `runs` entry. After a unit's first CI run set its `seconds` to the ones the
// shard's summary prints (a unit that takes more or less than its seconds by the larger of a quarter of them and 60 s is a warning with the number, never a failure).
//
// The first values are read from the runner's logs of N29's measurements (the last 20 runs, both engines): the phases from the order and time of their output, the controls from the table of seconds each control printed, less the 8 s
// every run waited for at its end (N29: a timer that nothing cleared), the new ones (the controls of the load that fails and of the Plugins page, which no CI step ran before) by the scenario's own seconds.

export const units = [
  // The phases. `pages` is the thirteen scenarios of one page each on the first host (healthy to the notification centre); the Terminal tool's six are in three units so that a shard can take a part of them.
  {
    id: 'pages',
    phases: ['healthy', 'rail', 'panel', 'panel-late', 'logs', 'palette', 'twins', 'connection', 'providers', 'kept', 'identity', 'toasts', 'centre'],
    seconds: 85,
  },
  { id: 'settings', phases: ['settings'], seconds: 75 },
  { id: 'terminal-core', phases: ['terminal', 'terminal-programs', 'terminal-reattach'], seconds: 100 },
  { id: 'terminal-restart', phases: ['terminal-takeover', 'terminal-followups'], seconds: 100 },
  // The Terminal tool's cuts of the page's two sockets (r6) and the isolation of two pages (r7): the phases' own seconds as the check prints them (`SEAM-PHASE`: 19.9 and 9.7 on the laptop, chromium; the first CI run of #716 printed the older, shorter versions of the two at 17 s and 5 s), rounded up together.
  { id: 'terminal-channel', phases: ['terminal-reconnect', 'terminal-isolation'], seconds: 30 },
  { id: 'terminal-find', phases: ['terminal-find'], seconds: 35 },
  { id: 'session', phases: ['session'], seconds: 15 },
  // The scenarios that start a plugin's process (the Go fixture is built once for the run).
  { id: 'plugin-process', phases: ['process', 'failed-load', 'plugins-page'], seconds: 135 },
  { id: 'connections-problems', phases: ['connections', 'problems-operations'], seconds: 65 },
  // Scenario w, the Ports tool (PF1, PF2): the port forwards the host lists, with Stop, the disabled Open and Copy port, and the bounds of `ctx.panel.ports.forward` (a user action, a cap of 64, a bounded id) on a host of its own. It took 62 s on the laptop (load 3, both engines; 32 s before PF2: the 1,000 forwards and the 9 s the lapsed call must be left alone), so 75 s here; the first CI run gives the real one.
  { id: 'ports', phases: ['ports'], seconds: 75 },

  // The negative controls. Scenario k (a plugin's unload and the Logs sessions) and the watch over failed requests with m (the identity of a Logs session).
  { id: 'controls-kept', runs: ['double-close', 'new-view', 'failed-ended', 'close-twice', 'page-error'], seconds: 55 },
  { id: 'controls-identity', runs: ['second-stream', 'scope-lone', 'scope-kept', 'same-name', 'runtime-4xx'], seconds: 40 },
  // Scenario s, Settings: each control runs the part it belongs to alone. `reach`, `reconnect` and `slots` are the three that take more than a few seconds (the slots part opens 100 windows).
  {
    id: 'controls-settings',
    runs: [
      'settings-persist',
      'settings-words',
      'settings-hide',
      'settings-draft',
      'settings-secret-saved',
      'settings-secret-dom',
      'settings-secret-log',
      'settings-tooltip',
      'settings-typeahead',
      'settings-error',
      'settings-log',
    ],
    seconds: 65,
  },
  { id: 'controls-settings-slow', runs: ['settings-reach', 'settings-reconnect', 'settings-slots'], seconds: 100 },
  // The scenarios that have a table of controls of their own, each made by one run of the whole table.
  { id: 'controls-process', runs: ['process'], seconds: 50 },
  { id: 'controls-failed-load', runs: ['failed-load'], seconds: 40 },
  { id: 'controls-plugins-page', runs: ['plugins-page'], seconds: 60 },
  { id: 'controls-connections-problems', runs: ['connections', 'problems-operations'], seconds: 80 },
  { id: 'controls-ports', runs: ['ports'], seconds: 90 },
  // The controls of r6 and r7, one run of each table: the first is the runner's (`control terminal-reconnect: detected (50 s)`, which the laptop measured the same), the second has no runner figure yet (the CI step that was to run it failed to start it) and is the laptop's (26 s, its four controls with the host's start).
  { id: 'controls-terminal-channel', runs: ['terminal-reconnect', 'terminal-isolation'], seconds: 76 },
];
